import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentEvents1732610000003 implements MigrationInterface {
  name = 'PaymentEvents1732610000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE payment_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id uuid NOT NULL REFERENCES merchants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        store_id uuid NOT NULL REFERENCES stores(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        user_id uuid NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        sale_id uuid NOT NULL UNIQUE REFERENCES sales(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        payment_status varchar(20) NOT NULL,
        amount_cents integer NOT NULL CHECK (amount_cents >= 0),
        currency varchar(3) NOT NULL DEFAULT 'INR',
        provider varchar(32) NOT NULL,
        provider_reference varchar(128) NOT NULL,
        items jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT payment_events_status_check CHECK (payment_status IN ('SUCCESS', 'FAILED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_payment_events_store_created ON payment_events(store_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_payment_events_merchant_created ON payment_events(merchant_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_payment_events_store_status ON payment_events(store_id, payment_status, created_at DESC)`,
    );

    await queryRunner.query(`
      INSERT INTO payment_events (
        merchant_id, store_id, user_id, sale_id, payment_status,
        amount_cents, currency, provider, provider_reference, items, created_at
      )
      SELECT
        st.merchant_id,
        s.store_id,
        s.user_id,
        s.id,
        p.status,
        p.amount_cents,
        s.currency,
        p.provider,
        p.provider_reference,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'productId', i.product_id,
            'sku', i.sku,
            'productName', i.product_name,
            'quantity', i.quantity,
            'lineTotalCents', i.line_total_cents
          ) ORDER BY i.product_id)
          FROM sale_items i
          WHERE i.sale_id = s.id
        ), '[]'::jsonb),
        s.created_at
      FROM sales s
      JOIN payments p ON p.sale_id = s.id
      JOIN stores st ON st.id = s.store_id
      WHERE s.status IN ('COMPLETED', 'FAILED')
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION pos_create_sale(
        p_store_id uuid,
        p_user_id uuid,
        p_idempotency_key varchar,
        p_request_hash varchar,
        p_provider varchar,
        p_payment_status varchar,
        p_provider_reference varchar,
        p_items jsonb
      )
      RETURNS jsonb
      LANGUAGE plpgsql
      AS $fn$
      DECLARE
        v_existing sales%ROWTYPE;
        v_expected int;
        v_seen int := 0;
        v_total int := 0;
        v_line record;
        v_product_ids uuid[] := '{}';
        v_skus varchar[] := '{}';
        v_names varchar[] := '{}';
        v_qtys int[] := '{}';
        v_prices int[] := '{}';
        v_short_id uuid;
        v_short_name varchar;
        v_short_available int;
        v_short_requested int;
        v_sale_id uuid;
        v_status varchar;
        v_updated int;
      BEGIN
        IF p_payment_status NOT IN ('SUCCESS', 'FAILED') THEN
          RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'P0001';
        END IF;

        SELECT * INTO v_existing
        FROM sales
        WHERE store_id = p_store_id AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
          IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH' USING ERRCODE = 'P0001';
          END IF;
          RETURN pos_sale_json(v_existing.id) || jsonb_build_object('replayed', true);
        END IF;

        SELECT count(DISTINCT (item->>'productId')::uuid) INTO v_expected
        FROM jsonb_array_elements(p_items) AS item;

        FOR v_line IN
          SELECT p.id AS product_id,
                 p.sku,
                 p.name,
                 p.price_cents,
                 i.quantity_on_hand,
                 (item->>'quantity')::int AS quantity
          FROM jsonb_array_elements(p_items) AS item
          JOIN products p
            ON p.id = (item->>'productId')::uuid
           AND p.store_id = p_store_id
           AND p.is_active = true
          JOIN inventory i
            ON i.store_id = p_store_id
           AND i.product_id = p.id
          ORDER BY p.id
          FOR UPDATE OF i
        LOOP
          v_seen := v_seen + 1;
          v_total := v_total + v_line.price_cents * v_line.quantity;
          IF v_line.quantity_on_hand < v_line.quantity AND v_short_id IS NULL THEN
            v_short_id := v_line.product_id;
            v_short_name := v_line.name;
            v_short_available := v_line.quantity_on_hand;
            v_short_requested := v_line.quantity;
          END IF;
          v_product_ids := array_append(v_product_ids, v_line.product_id);
          v_skus := array_append(v_skus, v_line.sku);
          v_names := array_append(v_names, v_line.name);
          v_qtys := array_append(v_qtys, v_line.quantity);
          v_prices := array_append(v_prices, v_line.price_cents);
        END LOOP;

        IF v_seen <> v_expected THEN
          RAISE EXCEPTION 'INVALID_PRODUCT' USING ERRCODE = 'P0001';
        END IF;

        IF v_short_id IS NOT NULL THEN
          RAISE EXCEPTION 'INSUFFICIENT_INVENTORY'
            USING ERRCODE = 'P0001',
                  DETAIL = json_build_object(
                    'productId', v_short_id,
                    'available', v_short_available,
                    'requested', v_short_requested,
                    'name', v_short_name
                  )::text;
        END IF;

        IF v_total > 2000000000 THEN
          RAISE EXCEPTION 'AMOUNT_TOO_LARGE' USING ERRCODE = 'P0001';
        END IF;

        v_status := CASE WHEN p_payment_status = 'SUCCESS' THEN 'COMPLETED' ELSE 'FAILED' END;

        INSERT INTO sales (
          store_id, user_id, idempotency_key, request_hash, status, total_cents, currency
        ) VALUES (
          p_store_id, p_user_id, p_idempotency_key, p_request_hash, v_status, v_total, 'INR'
        )
        RETURNING id INTO v_sale_id;

        INSERT INTO sale_items (
          sale_id, product_id, sku, product_name, quantity, unit_price_cents, line_total_cents
        )
        SELECT v_sale_id, line.product_id, line.sku, line.name, line.quantity, line.price, line.price * line.quantity
        FROM unnest(v_product_ids, v_skus, v_names, v_qtys, v_prices)
          AS line(product_id, sku, name, quantity, price);

        IF p_payment_status = 'SUCCESS' THEN
          UPDATE inventory AS stock
          SET quantity_on_hand = stock.quantity_on_hand - line.quantity,
              updated_at = now()
          FROM unnest(v_product_ids, v_qtys) AS line(product_id, quantity)
          WHERE stock.store_id = p_store_id
            AND stock.product_id = line.product_id
            AND stock.quantity_on_hand >= line.quantity;

          GET DIAGNOSTICS v_updated = ROW_COUNT;
          IF v_updated <> v_expected THEN
            RAISE EXCEPTION 'INSUFFICIENT_INVENTORY' USING ERRCODE = 'P0001';
          END IF;
        END IF;

        INSERT INTO payments (sale_id, provider, status, amount_cents, provider_reference)
        VALUES (v_sale_id, p_provider, p_payment_status, v_total, p_provider_reference);

        INSERT INTO payment_events (
          merchant_id, store_id, user_id, sale_id, payment_status,
          amount_cents, currency, provider, provider_reference, items
        )
        SELECT
          st.merchant_id,
          p_store_id,
          p_user_id,
          v_sale_id,
          p_payment_status,
          v_total,
          'INR',
          p_provider,
          p_provider_reference,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'productId', line.product_id,
              'sku', line.sku,
              'productName', line.name,
              'quantity', line.quantity,
              'lineTotalCents', line.price * line.quantity
            ) ORDER BY line.product_id)
            FROM unnest(v_product_ids, v_skus, v_names, v_qtys, v_prices)
              AS line(product_id, sku, name, quantity, price)
          ), '[]'::jsonb)
        FROM stores st
        WHERE st.id = p_store_id;

        RETURN pos_sale_json(v_sale_id) || jsonb_build_object('replayed', false);
      END;
      $fn$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS payment_events`);
  }
}
