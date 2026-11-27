import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SaleStatus } from '../common/enums';
import { Payment, Sale, SaleItem } from '../database/entities';

export interface NewSaleLine {
  productId: string;
  quantity: number;
}

export interface SaleGraph {
  sale: Sale;
  items: SaleItem[];
  payment: Payment | null;
}

interface SaleJson {
  id: string;
  storeId: string;
  userId: string;
  status: SaleStatus;
  currency: string;
  totalCents: number;
  idempotencyKey: string;
  requestHash: string;
  createdAt: string | Date;
  items: SaleItem[] | string | null;
  payment: Payment | string | null;
  replayed?: boolean;
}

@Injectable()
export class SalesRepository implements OnModuleInit {
  private readonly prices = new Map<string, number>();

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.refreshPrices();
  }

  async quoteCents(storeId: string, items: NewSaleLine[]): Promise<number> {
    let total = 0;
    for (const item of items) {
      let price = this.prices.get(`${storeId}:${item.productId}`);
      if (price === undefined) {
        await this.refreshPrices();
        price = this.prices.get(`${storeId}:${item.productId}`);
      }
      if (price === undefined) {
        return 0;
      }
      total += price * item.quantity;
    }
    return total;
  }

  private async refreshPrices(): Promise<void> {
    const rows: Array<{ store_id: string; id: string; price_cents: number }> = await this.dataSource.query(
      `SELECT store_id, id, price_cents FROM products WHERE is_active = true`,
    );
    this.prices.clear();
    for (const row of rows) {
      this.prices.set(`${row.store_id}:${row.id}`, Number(row.price_cents));
    }
  }

  findByIdempotencyKey(storeId: string, idempotencyKey: string): Promise<SaleGraph | null> {
    return this.one(storeId, { idempotencyKey });
  }

  findById(storeId: string, saleId: string): Promise<SaleGraph | null> {
    return this.one(storeId, { saleId });
  }

  async list(storeId: string, limit: number, idempotencyKey?: string): Promise<SaleGraph[]> {
    const rows = await this.queryGraphs(storeId, limit, { idempotencyKey });
    return rows.map((row) => toGraph(row));
  }

  async createAtomic(input: {
    storeId: string;
    userId: string;
    idempotencyKey: string;
    requestHash: string;
    provider: string;
    paymentStatus: 'SUCCESS' | 'FAILED';
    providerReference: string;
    items: NewSaleLine[];
  }): Promise<{ graph: SaleGraph; replayed: boolean }> {
    const rows: Array<{ result: SaleJson | string }> = await this.dataSource.query(
      `SELECT pos_create_sale($1, $2, $3, $4, $5, $6, $7, $8::jsonb) AS result`,
      [
        input.storeId,
        input.userId,
        input.idempotencyKey,
        input.requestHash,
        input.provider,
        input.paymentStatus,
        input.providerReference,
        JSON.stringify(input.items.map((item) => ({ productId: item.productId, quantity: item.quantity }))),
      ],
    );
    const result = parseJson<SaleJson>(rows[0]?.result);
    return { graph: toGraph(result), replayed: result.replayed === true };
  }

  private async one(
    storeId: string,
    filter: { saleId?: string; idempotencyKey?: string },
  ): Promise<SaleGraph | null> {
    const rows = await this.queryGraphs(storeId, 1, filter);
    return rows[0] ? toGraph(rows[0]) : null;
  }

  private queryGraphs(
    storeId: string,
    limit: number,
    filter: { saleId?: string; idempotencyKey?: string },
  ): Promise<SaleJson[]> {
    return this.dataSource.query(
      `SELECT
         s.id,
         s.store_id AS "storeId",
         s.user_id AS "userId",
         s.status,
         s.currency,
         s.total_cents AS "totalCents",
         s.idempotency_key AS "idempotencyKey",
         s.request_hash AS "requestHash",
         s.created_at AS "createdAt",
         COALESCE((
           SELECT json_agg(json_build_object(
             'productId', i.product_id,
             'sku', i.sku,
             'productName', i.product_name,
             'quantity', i.quantity,
             'unitPriceCents', i.unit_price_cents,
             'lineTotalCents', i.line_total_cents
           ) ORDER BY i.product_id)
           FROM sale_items i
           WHERE i.sale_id = s.id
         ), '[]'::json) AS items,
         (
           SELECT json_build_object(
             'provider', pay.provider,
             'status', pay.status,
             'amountCents', pay.amount_cents,
             'providerReference', pay.provider_reference
           )
           FROM payments pay
           WHERE pay.sale_id = s.id
         ) AS payment
       FROM sales s
       WHERE s.store_id = $1
         AND ($2::uuid IS NULL OR s.id = $2)
         AND ($3::varchar IS NULL OR s.idempotency_key = $3)
       ORDER BY s.created_at DESC
       LIMIT $4`,
      [storeId, filter.saleId ?? null, filter.idempotencyKey ?? null, limit],
    );
  }
}

function toGraph(row: SaleJson): SaleGraph {
  const items = parseJson<SaleItem[]>(row.items ?? []) ?? [];
  const payment = row.payment ? parseJson<Payment>(row.payment) : null;
  return {
    sale: {
      id: row.id,
      storeId: row.storeId,
      userId: row.userId,
      status: row.status,
      currency: row.currency,
      totalCents: Number(row.totalCents),
      idempotencyKey: row.idempotencyKey,
      requestHash: row.requestHash,
      createdAt: row.createdAt,
    } as Sale,
    items: items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      unitPriceCents: Number(item.unitPriceCents),
      lineTotalCents: Number(item.lineTotalCents),
    })),
    payment: payment
      ? ({
          ...payment,
          amountCents: Number(payment.amountCents),
        } as Payment)
      : null,
  };
}

function parseJson<T>(value: T | string | null): T {
  if (typeof value === 'string') {
    return JSON.parse(value) as T;
  }
  return value as T;
}
