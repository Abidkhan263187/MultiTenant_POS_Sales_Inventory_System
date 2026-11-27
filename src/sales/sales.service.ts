import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthUser } from '../common/auth-user';
import { CURRENCY, SaleStatus } from '../common/enums';
import { isDeadlock, isUniqueViolation, postgresErrorField } from '../common/postgres-error';
import { PAYMENT_PROVIDER, PaymentProvider } from '../payments/payment-provider';
import { CreateSaleDto, ListSalesQueryDto } from './dto/sale.dto';
import { hashSaleRequest, mergeSaleItems } from './sale-request.util';
import { formatInr } from '../common/money';
import { SaleGraph, SalesRepository } from './sales.repository';

export interface SaleView {
  id: string;
  storeId: string;
  userId: string;
  status: SaleStatus;
  currency: string;
  totalCents: number;
  totalLabel: string;
  summary: string;
  idempotencyKey: string;
  items: Array<{
    productId: string;
    sku: string;
    productName: string;
    quantity: number;
    unitPriceCents: number;
    unitPriceLabel: string;
    lineTotalCents: number;
    lineTotalLabel: string;
  }>;
  payment: {
    provider: string;
    status: string;
    amountCents: number;
    amountLabel: string;
    providerReference: string;
  } | null;
  createdAt: Date;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly sales: SalesRepository,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  async list(storeId: string, query: ListSalesQueryDto): Promise<SaleView[]> {
    const graphs = await this.sales.list(storeId, query.limit ?? 50, query.idempotencyKey);
    return graphs.map(toSaleView);
  }

  async getOne(storeId: string, saleId: string): Promise<SaleView> {
    const graph = await this.sales.findById(storeId, saleId);
    if (!graph) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'No sale was found with that id in this store.',
      });
    }
    return toSaleView(graph);
  }

  async create(
    user: AuthUser,
    storeId: string,
    dto: CreateSaleDto,
    idempotencyKey: string | undefined,
  ): Promise<{ sale: SaleView; replayed: boolean }> {
    const key = normalizeIdempotencyKey(idempotencyKey);
    const merged = mergeSaleItems(dto.items);
    for (const item of merged) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Enter a quantity from 1 to 1000 for each product.',
        });
      }
    }
    const requestHash = hashSaleRequest(merged, dto.paymentOutcome);

    const charge = await this.paymentProvider.charge({
      amountCents: await this.sales.quoteCents(storeId, merged),
      currency: CURRENCY,
      idempotencyKey: key,
      outcome: dto.paymentOutcome,
    });

    try {
      const created = await this.sales.createAtomic({
        storeId,
        userId: user.id,
        idempotencyKey: key,
        requestHash,
        provider: charge.provider,
        paymentStatus: charge.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
        providerReference: charge.providerReference || `mock_fail_${key}`,
        items: merged,
      });
      return { sale: toSaleView(created.graph), replayed: created.replayed };
    } catch (error) {
      const raised = saleError(error);
      if (raised) {
        throw raised;
      }
      if (isUniqueViolation(error)) {
        const existing = await this.sales.findByIdempotencyKey(storeId, key);
        if (existing) {
          assertSamePayload(existing, requestHash);
          return { sale: toSaleView(existing), replayed: true };
        }
      }
      if (isDeadlock(error)) {
        throw new ConflictException({
          code: 'CONCURRENT_CONFLICT',
          message: 'Another sale updated this stock at the same time. Please try the sale again.',
        });
      }
      throw error;
    }
  }
}

function normalizeIdempotencyKey(value: string | undefined): string {
  const key = value?.trim() ?? '';
  if (!key || key.length > 128) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message:
        'Add an Idempotency-Key header so a repeated tap does not charge the customer twice. Use at most 128 characters.',
    });
  }
  return key;
}

function saleError(error: unknown): BadRequestException | ConflictException | null {
  const message = postgresErrorField(error, 'message');
  if (message.includes('IDEMPOTENCY_PAYLOAD_MISMATCH')) {
    return new ConflictException({
      code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
      message: 'This Idempotency-Key was already used for a different sale. Start a new sale with a new key.',
    });
  }
  if (message.includes('INVALID_PRODUCT')) {
    return new BadRequestException({
      code: 'INVALID_PRODUCT',
      message: 'One or more products are not sold at this store. Choose products from this store.',
    });
  }
  if (message.includes('AMOUNT_TOO_LARGE')) {
    return new BadRequestException({
      code: 'AMOUNT_TOO_LARGE',
      message: 'This sale total is too large to process.',
    });
  }
  if (message.includes('INSUFFICIENT_INVENTORY')) {
    const detail = parseDetail(postgresErrorField(error, 'detail'));
    const available = Number(detail?.available);
    const requested = Number(detail?.requested);
    const name = typeof detail?.name === 'string' ? detail.name : 'This product';
    return new ConflictException({
      code: 'INSUFFICIENT_INVENTORY',
      message:
        available === 0
          ? `${name} is out of stock, so this sale was not completed.`
          : Number.isFinite(available) && Number.isFinite(requested)
            ? `${name} has ${available} in stock. This sale asks for ${requested}, so it was not completed.`
            : `${name} does not have enough stock. The sale was not completed and stock was not changed.`,
      ...(detail?.productId ? { productId: detail.productId } : {}),
      ...(Number.isFinite(available) ? { available } : {}),
      ...(Number.isFinite(requested) ? { requested } : {}),
    });
  }
  return null;
}

function parseDetail(detail: string): Record<string, unknown> | null {
  if (!detail) {
    return null;
  }
  try {
    const value = JSON.parse(detail) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function assertSamePayload(existing: SaleGraph, requestHash: string): void {
  if (existing.sale.requestHash !== requestHash) {
    throw new ConflictException({
      code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
      message: 'This Idempotency-Key was already used for a different sale. Start a new sale with a new key.',
    });
  }
}

function toSaleView(graph: SaleGraph): SaleView {
  const items = [...graph.items].sort((a, b) => a.productId.localeCompare(b.productId));
  return {
    id: graph.sale.id,
    storeId: graph.sale.storeId,
    userId: graph.sale.userId,
    status: graph.sale.status,
    currency: graph.sale.currency,
    totalCents: graph.sale.totalCents,
    totalLabel: formatInr(graph.sale.totalCents),
    summary: saleSummary(graph.sale.status, items, graph.sale.totalCents),
    idempotencyKey: graph.sale.idempotencyKey,
    items: items.map((item) => ({
      productId: item.productId,
      sku: item.sku,
      productName: item.productName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      unitPriceLabel: formatInr(item.unitPriceCents),
      lineTotalCents: item.lineTotalCents,
      lineTotalLabel: formatInr(item.lineTotalCents),
    })),
    payment: graph.payment
      ? {
          provider: graph.payment.provider,
          status: graph.payment.status,
          amountCents: graph.payment.amountCents,
          amountLabel: formatInr(graph.payment.amountCents),
          providerReference: graph.payment.providerReference,
        }
      : null,
    createdAt: graph.sale.createdAt,
  };
}

function saleSummary(
  status: SaleStatus,
  items: Array<{ quantity: number; productName: string }>,
  totalCents: number,
): string {
  const lines = items.map((item) => `${item.quantity} × ${item.productName}`).join(', ');
  const total = formatInr(totalCents);
  if (status === SaleStatus.FAILED) {
    return `Payment was declined for ${lines}. Total ${total}. Stock was not changed.`;
  }
  if (status === SaleStatus.COMPLETED) {
    return `Sale completed: ${lines}. Total ${total}. Stock has been updated.`;
  }
  return `Sale is waiting for payment: ${lines}. Total ${total}.`;
}
