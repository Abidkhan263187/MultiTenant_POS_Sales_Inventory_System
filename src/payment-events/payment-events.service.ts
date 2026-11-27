import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { Role } from '../common/enums';
import { formatInr } from '../common/money';
import { ListPaymentEventsQueryDto } from './dto/list-payment-events.dto';

interface EventRow {
  id: string;
  merchantId: string;
  storeId: string;
  storeName: string;
  userId: string;
  userName: string;
  saleId: string;
  paymentStatus: 'SUCCESS' | 'FAILED';
  amountCents: number;
  currency: string;
  provider: string;
  providerReference: string;
  items: EventItem[] | string;
  createdAt: Date | string;
}

interface EventItem {
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  lineTotalCents: number;
}

@Injectable()
export class PaymentEventsService {
  constructor(private readonly dataSource: DataSource) {}

  listForStore(storeId: string, query: ListPaymentEventsQueryDto) {
    return this.list({ storeId, merchantId: null, query });
  }

  async listForUser(user: AuthUser, query: ListPaymentEventsQueryDto) {
    const storeId = user.role === Role.MERCHANT_ADMIN ? null : user.storeId;
    return this.list({ storeId, merchantId: user.merchantId, query });
  }

  async summaryForStore(storeId: string) {
    const rows = await this.dataSource.query(
      `SELECT
         count(*) FILTER (WHERE payment_status = 'FAILED')::int AS "failedCount",
         COALESCE(sum(amount_cents) FILTER (WHERE payment_status = 'FAILED'), 0)::int AS "failedAmountCents",
         count(*) FILTER (WHERE payment_status = 'SUCCESS')::int AS "paidCount",
         COALESCE(sum(amount_cents) FILTER (WHERE payment_status = 'SUCCESS'), 0)::int AS "paidAmountCents"
       FROM payment_events
       WHERE store_id = $1`,
      [storeId],
    );
    return toSummary(storeId, rows[0]);
  }

  async summaryForUser(user: AuthUser) {
    const storeId = user.role === Role.MERCHANT_ADMIN ? null : user.storeId;
    const rows = await this.dataSource.query(
      `SELECT
         count(*) FILTER (WHERE payment_status = 'FAILED')::int AS "failedCount",
         COALESCE(sum(amount_cents) FILTER (WHERE payment_status = 'FAILED'), 0)::int AS "failedAmountCents",
         count(*) FILTER (WHERE payment_status = 'SUCCESS')::int AS "paidCount",
         COALESCE(sum(amount_cents) FILTER (WHERE payment_status = 'SUCCESS'), 0)::int AS "paidAmountCents"
       FROM payment_events
       WHERE merchant_id = $1
         AND ($2::uuid IS NULL OR store_id = $2)`,
      [user.merchantId, storeId],
    );
    return toSummary(storeId, rows[0]);
  }

  private async list(input: {
    storeId: string | null;
    merchantId: string | null;
    query: ListPaymentEventsQueryDto;
  }) {
    const rows: EventRow[] = await this.dataSource.query(
      `SELECT
         e.id,
         e.merchant_id AS "merchantId",
         e.store_id AS "storeId",
         st.name AS "storeName",
         e.user_id AS "userId",
         u.full_name AS "userName",
         e.sale_id AS "saleId",
         e.payment_status AS "paymentStatus",
         e.amount_cents AS "amountCents",
         e.currency,
         e.provider,
         e.provider_reference AS "providerReference",
         e.items,
         e.created_at AS "createdAt"
       FROM payment_events e
       JOIN stores st ON st.id = e.store_id
       JOIN users u ON u.id = e.user_id
       WHERE ($1::uuid IS NULL OR e.store_id = $1)
         AND ($2::uuid IS NULL OR e.merchant_id = $2)
         AND ($3::varchar IS NULL OR e.payment_status = $3)
         AND ($4::uuid IS NULL OR e.user_id = $4)
         AND (
           $5::uuid IS NULL
           OR e.items @> jsonb_build_array(jsonb_build_object('productId', $5::text))
         )
       ORDER BY e.created_at DESC
       LIMIT $6`,
      [
        input.storeId,
        input.merchantId,
        input.query.paymentStatus ?? null,
        input.query.userId ?? null,
        input.query.productId ?? null,
        input.query.limit ?? 50,
      ],
    );
    return rows.map(toEvent);
  }
}

function toEvent(row: EventRow) {
  const amountCents = Number(row.amountCents);
  const items = (typeof row.items === 'string' ? JSON.parse(row.items) : row.items) as EventItem[];
  return {
    id: row.id,
    merchantId: row.merchantId,
    storeId: row.storeId,
    storeName: row.storeName,
    userId: row.userId,
    userName: row.userName,
    saleId: row.saleId,
    paymentStatus: row.paymentStatus,
    amountCents,
    amountLabel: formatInr(amountCents),
    currency: row.currency,
    provider: row.provider,
    providerReference: row.providerReference,
    items: items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      lineTotalCents: Number(item.lineTotalCents),
      lineTotalLabel: formatInr(Number(item.lineTotalCents)),
    })),
    createdAt: row.createdAt,
    refundNote:
      row.paymentStatus === 'FAILED'
        ? 'The payment did not go through, so there is nothing to refund. Stock was not changed.'
        : 'The payment was taken. Use this sale if the customer needs a refund.',
  };
}

function toSummary(
  storeId: string | null,
  row: { failedCount: number; failedAmountCents: number; paidCount: number; paidAmountCents: number },
) {
  const failedAmountCents = Number(row.failedAmountCents);
  const paidAmountCents = Number(row.paidAmountCents);
  return {
    storeId,
    failedCount: Number(row.failedCount),
    failedAmountCents,
    failedAmountLabel: formatInr(failedAmountCents),
    paidCount: Number(row.paidCount),
    paidAmountCents,
    paidAmountLabel: formatInr(paidAmountCents),
  };
}
