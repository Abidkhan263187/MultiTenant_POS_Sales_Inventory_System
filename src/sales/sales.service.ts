import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { CURRENCY, SaleStatus } from '../common/enums';
import { isDeadlock, isUniqueViolation } from '../common/postgres-error';
import { InventoryRepository } from '../inventory/inventory.repository';
import { PAYMENT_PROVIDER, PaymentProvider } from '../payments/payment-provider';
import { ProductsRepository } from '../products/products.repository';
import { CreateSaleDto, ListSalesQueryDto } from './dto/sale.dto';
import { hashSaleRequest, mergeSaleItems } from './sale-request.util';
import { SaleGraph, SalesRepository } from './sales.repository';

export interface SaleView {
  id: string;
  storeId: string;
  userId: string;
  status: SaleStatus;
  currency: string;
  totalCents: number;
  idempotencyKey: string;
  items: Array<{
    productId: string;
    sku: string;
    productName: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
  payment: {
    provider: string;
    status: string;
    amountCents: number;
    providerReference: string;
  } | null;
  createdAt: Date;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly sales: SalesRepository,
    private readonly products: ProductsRepository,
    private readonly inventory: InventoryRepository,
    private readonly dataSource: DataSource,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  async list(storeId: string, query: ListSalesQueryDto): Promise<SaleView[]> {
    const graphs = await this.sales.list(storeId, query.limit ?? 50, query.idempotencyKey);
    return graphs.map(toSaleView);
  }

  async getOne(storeId: string, saleId: string): Promise<SaleView> {
    const graph = await this.sales.findById(storeId, saleId);
    if (!graph) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sale not found' });
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
          message: 'Combined quantity for a product must be between 1 and 1000',
        });
      }
    }
    const requestHash = hashSaleRequest(merged, dto.paymentOutcome);

    try {
      return await this.dataSource.transaction('READ COMMITTED', async (manager) => {
        const existing = await this.sales.findByIdempotencyKey(storeId, key, manager);
        if (existing) {
          assertSamePayload(existing, requestHash);
          return { sale: toSaleView(existing), replayed: true };
        }

        const productIds = merged.map((item) => item.productId);
        const products = await this.products.findActiveInStore(storeId, productIds, manager);
        if (products.length !== productIds.length) {
          throw new BadRequestException({
            code: 'INVALID_PRODUCT',
            message: 'One or more products are not available in this store',
          });
        }
        const productById = new Map(products.map((product) => [product.id, product]));

        // Lock stock rows in product id order so two terminals cannot deadlock.
        const inventoryRows = await this.inventory.lockForUpdate(storeId, productIds, manager);
        if (inventoryRows.length !== productIds.length) {
          throw new BadRequestException({
            code: 'INVALID_PRODUCT',
            message: 'Inventory is missing for one or more products',
          });
        }
        const inventoryByProduct = new Map(inventoryRows.map((row) => [row.productId, row]));

        const lines = merged.map((item) => {
          const product = productById.get(item.productId)!;
          const stock = inventoryByProduct.get(item.productId)!;
          if (stock.quantityOnHand < item.quantity) {
            throw new ConflictException({
              code: 'INSUFFICIENT_INVENTORY',
              message: `Insufficient inventory for ${product.sku}`,
              productId: product.id,
              available: stock.quantityOnHand,
              requested: item.quantity,
            });
          }
          return {
            productId: product.id,
            sku: product.sku,
            productName: product.name,
            quantity: item.quantity,
            unitPriceCents: product.priceCents,
            lineTotalCents: product.priceCents * item.quantity,
          };
        });

        const totalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
        if (totalCents > 2_000_000_000) {
          throw new BadRequestException({
            code: 'AMOUNT_TOO_LARGE',
            message: 'Sale total is too large',
          });
        }

        // Insert first so a retried or parallel request cannot charge twice.
        const pending = await this.sales.insertPending(manager, {
          storeId,
          userId: user.id,
          idempotencyKey: key,
          requestHash,
          totalCents,
          lines,
        });

        const charge = await this.paymentProvider.charge({
          amountCents: totalCents,
          currency: CURRENCY,
          idempotencyKey: key,
          outcome: dto.paymentOutcome,
        });
        if (charge.status !== 'SUCCESS') {
          const payment = await this.sales.markFailed(manager, pending.sale, {
            provider: charge.provider,
            providerReference: charge.providerReference || `mock_fail_${key}`,
            amountCents: totalCents,
          });
          return {
            sale: toSaleView({ sale: pending.sale, items: pending.items, payment }),
            replayed: false,
          };
        }

        for (const line of lines) {
          const affected = await this.inventory.decrementIfEnough(
            manager,
            storeId,
            line.productId,
            line.quantity,
          );
          if (affected !== 1) {
            throw new ConflictException({
              code: 'INSUFFICIENT_INVENTORY',
              message: 'Insufficient inventory',
              productId: line.productId,
            });
          }
        }

        const payment = await this.sales.markCompleted(manager, pending.sale, {
          provider: charge.provider,
          providerReference: charge.providerReference,
          amountCents: totalCents,
        });

        return {
          sale: toSaleView({ sale: pending.sale, items: pending.items, payment }),
          replayed: false,
        };
      });
    } catch (error) {
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
          message: 'Concurrent sale conflict. Please retry.',
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
      message: 'Idempotency-Key header is required and must be at most 128 characters',
    });
  }
  return key;
}

function assertSamePayload(existing: SaleGraph, requestHash: string): void {
  if (existing.sale.requestHash !== requestHash) {
    throw new ConflictException({
      code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
      message: 'This idempotency key was already used with a different request',
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
    idempotencyKey: graph.sale.idempotencyKey,
    items: items.map((item) => ({
      productId: item.productId,
      sku: item.sku,
      productName: item.productName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.lineTotalCents,
    })),
    payment: graph.payment
      ? {
          provider: graph.payment.provider,
          status: graph.payment.status,
          amountCents: graph.payment.amountCents,
          providerReference: graph.payment.providerReference,
        }
      : null,
    createdAt: graph.sale.createdAt,
  };
}
