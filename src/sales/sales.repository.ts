import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { CURRENCY, SaleStatus } from '../common/enums';
import { Payment, Sale, SaleItem } from '../database/entities';

export interface NewSaleLine {
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface SaleGraph {
  sale: Sale;
  items: SaleItem[];
  payment: Payment | null;
}

@Injectable()
export class SalesRepository {
  constructor(
    @InjectRepository(Sale) private readonly sales: Repository<Sale>,
    @InjectRepository(SaleItem) private readonly items: Repository<SaleItem>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
  ) {}

  private saleRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Sale) : this.sales;
  }

  private itemRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(SaleItem) : this.items;
  }

  private paymentRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Payment) : this.payments;
  }

  async findByIdempotencyKey(
    storeId: string,
    idempotencyKey: string,
    manager?: EntityManager,
  ): Promise<SaleGraph | null> {
    const sale = await this.saleRepo(manager).findOne({ where: { storeId, idempotencyKey } });
    if (!sale) {
      return null;
    }
    return this.withChildren(sale, manager);
  }

  async findById(storeId: string, saleId: string, manager?: EntityManager): Promise<SaleGraph | null> {
    const sale = await this.saleRepo(manager).findOne({ where: { id: saleId, storeId } });
    if (!sale) {
      return null;
    }
    return this.withChildren(sale, manager);
  }

  async list(storeId: string, limit: number, idempotencyKey?: string): Promise<SaleGraph[]> {
    const where = idempotencyKey ? { storeId, idempotencyKey } : { storeId };
    const sales = await this.sales.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
    if (sales.length === 0) {
      return [];
    }
    const saleIds = sales.map((sale) => sale.id);
    const [items, payments] = await Promise.all([
      this.items.find({ where: { saleId: In(saleIds) } }),
      this.payments.find({ where: { saleId: In(saleIds) } }),
    ]);
    return sales.map((sale) => ({
      sale,
      items: items.filter((item) => item.saleId === sale.id),
      payment: payments.find((payment) => payment.saleId === sale.id) ?? null,
    }));
  }

  async insertPending(
    manager: EntityManager,
    input: {
      storeId: string;
      userId: string;
      idempotencyKey: string;
      requestHash: string;
      totalCents: number;
      lines: NewSaleLine[];
    },
  ): Promise<SaleGraph> {
    const sale = await this.saleRepo(manager).save(
      this.saleRepo(manager).create({
        storeId: input.storeId,
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        status: SaleStatus.PENDING,
        totalCents: input.totalCents,
        currency: CURRENCY,
      }),
    );
    const items = await this.itemRepo(manager).save(
      input.lines.map((line) =>
        this.itemRepo(manager).create({
          saleId: sale.id,
          productId: line.productId,
          sku: line.sku,
          productName: line.productName,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          lineTotalCents: line.lineTotalCents,
        }),
      ),
    );
    return { sale, items, payment: null };
  }

  markCompleted(
    manager: EntityManager,
    sale: Sale,
    paymentInput: { provider: string; providerReference: string; amountCents: number },
  ): Promise<Payment> {
    return this.finish(manager, sale, SaleStatus.COMPLETED, 'SUCCESS', paymentInput);
  }

  markFailed(
    manager: EntityManager,
    sale: Sale,
    paymentInput: { provider: string; providerReference: string; amountCents: number },
  ): Promise<Payment> {
    return this.finish(manager, sale, SaleStatus.FAILED, 'FAILED', paymentInput);
  }

  private async finish(
    manager: EntityManager,
    sale: Sale,
    status: SaleStatus,
    paymentStatus: 'SUCCESS' | 'FAILED',
    paymentInput: { provider: string; providerReference: string; amountCents: number },
  ): Promise<Payment> {
    sale.status = status;
    await this.saleRepo(manager).save(sale);
    return this.paymentRepo(manager).save(
      this.paymentRepo(manager).create({
        saleId: sale.id,
        provider: paymentInput.provider,
        status: paymentStatus,
        amountCents: paymentInput.amountCents,
        providerReference: paymentInput.providerReference,
      }),
    );
  }

  private async withChildren(sale: Sale, manager?: EntityManager): Promise<SaleGraph> {
    const [items, payment] = await Promise.all([
      this.itemRepo(manager).find({ where: { saleId: sale.id }, order: { productId: 'ASC' } }),
      this.paymentRepo(manager).findOne({ where: { saleId: sale.id } }),
    ]);
    return { sale, items, payment };
  }
}
