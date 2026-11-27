import { MigrationInterface, QueryRunner } from 'typeorm';

export class FastSale1732610000002 implements MigrationInterface {
  name = 'FastSale1732610000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION pos_sale_json(p_sale_id uuid)
      RETURNS jsonb
      LANGUAGE sql
      STABLE
      AS $fn$
        SELECT jsonb_build_object(
          'id', s.id,
          'storeId', s.store_id,
          'userId', s.user_id,
          'status', s.status,
          'currency', s.currency,
          'totalCents', s.total_cents,
          'idempotencyKey', s.idempotency_key,
          'requestHash', s.request_hash,
          'createdAt', s.created_at,
          'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'productId', i.product_id,
              'sku', i.sku,
              'productName', i.product_name,
              'quantity', i.quantity,
              'unitPriceCents', i.unit_price_cents,
              'lineTotalCents', i.line_total_cents
            ) ORDER BY i.product_id)
            FROM sale_items i
            WHERE i.sale_id = s.id
          ), '[]'::jsonb),
          'payment', (
            SELECT jsonb_build_object(
              'provider', pay.provider,
              'status', pay.status,
              'amountCents', pay.amount_cents,
              'providerReference', pay.provider_reference
            )
            FROM payments pay
            WHERE pay.sale_id = s.id
          )
        )
        FROM sales s
        WHERE s.id = p_sale_id;
      $fn$
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

        RETURN pos_sale_json(v_sale_id) || jsonb_build_object('replayed', false);
      END;
      $fn$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS pos_create_sale(uuid, uuid, varchar, varchar, varchar, varchar, varchar, jsonb)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS pos_sale_json(uuid)`);
  }
}
