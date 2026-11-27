import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { formatInr } from '../common/money';
import { Product } from '../database/entities';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { InventoryRepository } from './inventory.repository';

export interface InventoryView {
  productId: string;
  sku: string;
  name: string;
  priceCents: number;
  priceLabel: string;
  isActive: boolean;
  quantityOnHand: number;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly inventory: InventoryRepository,
    private readonly dataSource: DataSource,
  ) {}

  async list(storeId: string): Promise<InventoryView[]> {
    const rows = await this.inventory.listForStore(storeId);
    return rows.map((row) => ({
      ...row,
      priceLabel: formatInr(Number(row.priceCents)),
      priceCents: Number(row.priceCents),
      quantityOnHand: Number(row.quantityOnHand),
    }));
  }

  async adjust(storeId: string, dto: AdjustInventoryDto): Promise<InventoryView> {
    if (dto.delta === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Enter how many units to add or remove. Zero does not change the stock.',
      });
    }

    const product = await this.dataSource.getRepository(Product).findOne({
      where: { id: dto.productId, storeId },
    });
    if (!product) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'That product was not found in this store.',
      });
    }

    const affected = await this.dataSource.transaction(async (manager) => {
      const locked = await this.inventory.lockForUpdate(storeId, [dto.productId], manager);
      if (locked.length !== 1) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'This product has no stock record. Set the opening stock before adjusting it.',
        });
      }
      const affected = await this.inventory.applyDelta(manager, storeId, dto.productId, dto.delta);
      return { affected, onHand: locked[0].quantityOnHand };
    });

    if (affected.affected !== 1) {
      const removing = Math.abs(dto.delta);
      throw new ConflictException({
        code: 'INSUFFICIENT_INVENTORY',
        message: `${product.name} has ${affected.onHand} in stock. Removing ${removing} would take it below zero, so the stock was left unchanged.`,
        productId: dto.productId,
        available: affected.onHand,
        requested: removing,
      });
    }

    const updated = await this.inventory.findOne(storeId, dto.productId);
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      priceCents: product.priceCents,
      priceLabel: formatInr(product.priceCents),
      isActive: product.isActive,
      quantityOnHand: updated?.quantityOnHand ?? 0,
    };
  }
}
