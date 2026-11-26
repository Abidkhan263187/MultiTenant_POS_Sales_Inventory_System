import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1732610000000 implements MigrationInterface {
  name = 'InitSchema1732610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE merchants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(160) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE stores (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id uuid NOT NULL REFERENCES merchants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        name varchar(160) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_stores_merchant_id ON stores(merchant_id)`);

    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id uuid NOT NULL REFERENCES merchants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        store_id uuid REFERENCES stores(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        email varchar(255) NOT NULL UNIQUE,
        password_hash varchar(255) NOT NULL,
        full_name varchar(160) NOT NULL,
        role varchar(32) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT users_role_check CHECK (role IN ('MERCHANT_ADMIN', 'STORE_MANAGER', 'CASHIER')),
        CONSTRAINT users_store_scope_check CHECK (
          (role = 'MERCHANT_ADMIN' AND store_id IS NULL)
          OR (role <> 'MERCHANT_ADMIN' AND store_id IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_users_merchant_id ON users(merchant_id)`);
    await queryRunner.query(`CREATE INDEX idx_users_store_id ON users(store_id)`);

    await queryRunner.query(`
      CREATE TABLE products (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id uuid NOT NULL REFERENCES stores(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        sku varchar(64) NOT NULL,
        name varchar(160) NOT NULL,
        price_cents integer NOT NULL CHECK (price_cents >= 0),
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_products_store_sku UNIQUE (store_id, sku)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_products_store_id ON products(store_id)`);

    await queryRunner.query(`
      CREATE TABLE inventory (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id uuid NOT NULL REFERENCES stores(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        product_id uuid NOT NULL REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        quantity_on_hand integer NOT NULL CHECK (quantity_on_hand >= 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_inventory_store_product UNIQUE (store_id, product_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_inventory_store_id ON inventory(store_id)`);

    await queryRunner.query(`
      CREATE TABLE sales (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id uuid NOT NULL REFERENCES stores(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        user_id uuid NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        idempotency_key varchar(128) NOT NULL,
        request_hash varchar(64) NOT NULL,
        status varchar(20) NOT NULL,
        total_cents integer NOT NULL CHECK (total_cents >= 0),
        currency varchar(3) NOT NULL DEFAULT 'INR',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT sales_status_check CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
        CONSTRAINT uq_sales_store_idempotency UNIQUE (store_id, idempotency_key)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_sales_store_created ON sales(store_id, created_at DESC)`);

    await queryRunner.query(`
      CREATE TABLE sale_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sale_id uuid NOT NULL REFERENCES sales(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        product_id uuid NOT NULL REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        sku varchar(64) NOT NULL,
        product_name varchar(160) NOT NULL,
        quantity integer NOT NULL CHECK (quantity > 0),
        unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
        line_total_cents integer NOT NULL CHECK (line_total_cents >= 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_sale_items_sale_id ON sale_items(sale_id)`);

    await queryRunner.query(`
      CREATE TABLE payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sale_id uuid NOT NULL UNIQUE REFERENCES sales(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        provider varchar(32) NOT NULL,
        status varchar(20) NOT NULL,
        amount_cents integer NOT NULL CHECK (amount_cents >= 0),
        provider_reference varchar(128) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT payments_status_check CHECK (status IN ('SUCCESS', 'FAILED'))
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS payments`);
    await queryRunner.query(`DROP TABLE IF EXISTS sale_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS sales`);
    await queryRunner.query(`DROP TABLE IF EXISTS inventory`);
    await queryRunner.query(`DROP TABLE IF EXISTS products`);
    await queryRunner.query(`DROP TABLE IF EXISTS users`);
    await queryRunner.query(`DROP TABLE IF EXISTS stores`);
    await queryRunner.query(`DROP TABLE IF EXISTS merchants`);
  }
}
