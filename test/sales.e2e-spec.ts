import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { seed } from '../src/database/seed';
import { DEMO_PASSWORD, DEMO_USERS, IDS } from '../src/database/ids';

describe('POS sales', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    const dataSource = app.get(DataSource);
    await dataSource.runMigrations();
    await seed(dataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('completes a sale at the catalog price and decrements inventory', async () => {
    const admin = await login(DEMO_USERS.adminA);
    const cashier = await login(DEMO_USERS.cashierStore1);
    const product = await createProduct(admin, IDS.store1, 1250, 10);

    const rejected = await sell(cashier, IDS.store1, product.id, 2, 'SUCCESS', randomUUID(), {
      priceCents: 1,
    });
    expect(rejected.status).toBe(400);

    const key = randomUUID();
    const created = await sell(cashier, IDS.store1, product.id, 2, 'SUCCESS', key);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('COMPLETED');
    expect(created.body.totalCents).toBe(2500);
    expect(created.body.items[0].unitPriceCents).toBe(1250);
    expect(created.body.payment.status).toBe('SUCCESS');
    expect(await quantity(cashier, IDS.store1, product.id)).toBe(8);

    const listed = await request(app.getHttpServer())
      .get(`/api/stores/${IDS.store1}/orders`)
      .set('Authorization', `Bearer ${cashier}`)
      .query({ idempotencyKey: key })
      .expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe(created.body.id);
  });

  it('records a failed sale without changing inventory', async () => {
    const admin = await login(DEMO_USERS.adminA);
    const cashier = await login(DEMO_USERS.cashierStore1);
    const product = await createProduct(admin, IDS.store1, 500, 6);
    const key = randomUUID();

    const failed = await sell(cashier, IDS.store1, product.id, 2, 'FAILED', key);
    expect(failed.status).toBe(402);
    expect(failed.body.status).toBe('FAILED');
    expect(failed.body.payment.status).toBe('FAILED');
    expect(await quantity(cashier, IDS.store1, product.id)).toBe(6);

    const listed = await request(app.getHttpServer())
      .get(`/api/stores/${IDS.store1}/sales`)
      .set('Authorization', `Bearer ${cashier}`)
      .query({ idempotencyKey: key })
      .expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe(failed.body.id);

    const replay = await sell(cashier, IDS.store1, product.id, 2, 'FAILED', key);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(failed.body.id);
    expect(await quantity(cashier, IDS.store1, product.id)).toBe(6);
  });

  it('rejects a sale when inventory is insufficient', async () => {
    const admin = await login(DEMO_USERS.adminA);
    const cashier = await login(DEMO_USERS.cashierStore1);
    const product = await createProduct(admin, IDS.store1, 700, 2);

    const response = await sell(cashier, IDS.store1, product.id, 3, 'SUCCESS', randomUUID());
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('INSUFFICIENT_INVENTORY');
    expect(response.body.details.available).toBe(2);
    expect(await quantity(cashier, IDS.store1, product.id)).toBe(2);
  });

  it('rejects cross-tenant and cross-store access', async () => {
    const cashierB = await login(DEMO_USERS.cashierStore3);
    const cashierStore2 = await login(DEMO_USERS.cashierStore2);
    const cashierStore1 = await login(DEMO_USERS.cashierStore1);
    const adminA = await login(DEMO_USERS.adminA);

    const otherMerchant = await request(app.getHttpServer())
      .get(`/api/stores/${IDS.store1}/products`)
      .set('Authorization', `Bearer ${cashierB}`);
    expect(otherMerchant.status).toBe(403);

    const otherStore = await request(app.getHttpServer())
      .get(`/api/stores/${IDS.store1}/inventory`)
      .set('Authorization', `Bearer ${cashierStore2}`);
    expect(otherStore.status).toBe(403);

    await request(app.getHttpServer())
      .get(`/api/stores/${IDS.store2}/products`)
      .set('Authorization', `Bearer ${adminA}`)
      .expect(200);

    const foreignProduct = await sell(
      cashierStore1,
      IDS.store1,
      IDS.productSandwich,
      1,
      'SUCCESS',
      randomUUID(),
    );
    expect(foreignProduct.status).toBe(400);
    expect(foreignProduct.body.code).toBe('INVALID_PRODUCT');

    const createAttempt = await request(app.getHttpServer())
      .post(`/api/stores/${IDS.store1}/products`)
      .set('Authorization', `Bearer ${cashierStore1}`)
      .send({ name: 'Nope', sku: 'NOPE123', priceCents: 100, initialQuantity: 1 });
    expect(createAttempt.status).toBe(403);
  });

  it('does not create a second sale when the same request is retried', async () => {
    const admin = await login(DEMO_USERS.adminA);
    const cashier = await login(DEMO_USERS.cashierStore1);
    const product = await createProduct(admin, IDS.store1, 900, 9);
    const key = randomUUID();

    const first = await sell(cashier, IDS.store1, product.id, 2, 'SUCCESS', key);
    expect(first.status).toBe(201);
    const second = await sell(cashier, IDS.store1, product.id, 2, 'SUCCESS', key);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await quantity(cashier, IDS.store1, product.id)).toBe(7);

    const mismatch = await sell(cashier, IDS.store1, product.id, 1, 'SUCCESS', key);
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
    expect(await quantity(cashier, IDS.store1, product.id)).toBe(7);
  });

  it('lets only one of two concurrent sales take the remaining stock', async () => {
    const admin = await login(DEMO_USERS.adminA);
    const cashier = await login(DEMO_USERS.cashierStore1);
    const product = await createProduct(admin, IDS.store1, 400, 5);

    const [first, second] = await Promise.all([
      sell(cashier, IDS.store1, product.id, 3, 'SUCCESS', randomUUID()),
      sell(cashier, IDS.store1, product.id, 3, 'SUCCESS', randomUUID()),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await quantity(cashier, IDS.store1, product.id)).toBe(2);
  });

  it('reports whether the product catalog came from cache', async () => {
    const cashier = await login(DEMO_USERS.cashierStore1);
    const response = await request(app.getHttpServer())
      .get(`/api/stores/${IDS.store1}/products`)
      .set('Authorization', `Bearer ${cashier}`)
      .expect(200);
    expect(['HIT', 'MISS', 'BYPASS']).toContain(response.headers['x-cache']);
    expect(response.body.some((product: { id: string }) => product.id === IDS.productCoffee)).toBe(true);
  });

  function login(email: string): Promise<string> {
    return request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: DEMO_PASSWORD })
      .expect(200)
      .then((response) => response.body.accessToken as string);
  }

  function createProduct(
    token: string,
    storeId: string,
    priceCents: number,
    initialQuantity: number,
  ) {
    const sku = `TST${Date.now()}${Math.floor(Math.random() * 100000)}`;
    return request(app.getHttpServer())
      .post(`/api/stores/${storeId}/products`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Item', sku, priceCents, initialQuantity })
      .expect(201)
      .then((response) => response.body as { id: string; priceCents: number });
  }

  function sell(
    token: string,
    storeId: string,
    productId: string,
    quantity: number,
    paymentOutcome: 'SUCCESS' | 'FAILED',
    idempotencyKey: string,
    extra: Record<string, unknown> = {},
  ) {
    return request(app.getHttpServer())
      .post(`/api/stores/${storeId}/sales`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ items: [{ productId, quantity }], paymentOutcome, ...extra });
  }

  async function quantity(token: string, storeId: string, productId: string): Promise<number> {
    const response = await request(app.getHttpServer())
      .get(`/api/stores/${storeId}/inventory`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const row = response.body.find((item: { productId: string }) => item.productId === productId);
    return row.quantityOnHand as number;
  }
});
