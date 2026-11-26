import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Product } from '../database/entities';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { InventoryRepository } from './inventory.repository';

export interface InventoryView {
  productId: string;
  sku: string;
  name: string;
  priceCents: number;
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
    const rows = await this.inventory.findByStore(storeId);
    if (rows.length === 0) {
      return [];
    }
    const products = await this.dataSource.getRepository(Product).find({ where: { storeId } });
    const byId = new Map(products.map((product) => [product.id, product]));

    return rows
      .map((row) => {
        const product = byId.get(row.productId);
        if (!product) {
          return null;
        }
        return {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          priceCents: product.priceCents,
          isActive: product.isActive,
          quantityOnHand: row.quantityOnHand,
        };
      })
      .filter((row): row is InventoryView => row !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async adjust(storeId: string, dto: AdjustInventoryDto): Promise<InventoryView> {
    if (dto.delta === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Inventory delta cannot be zero',
      });
    }

    const product = await this.dataSource.getRepository(Product).findOne({
      where: { id: dto.productId, storeId },
    });
    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found in this store' });
    }

    const affected = await this.dataSource.transaction(async (manager) => {
      const locked = await this.inventory.lockForUpdate(storeId, [dto.productId], manager);
      if (locked.length !== 1) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Inventory record not found' });
      }
      return this.inventory.applyDelta(manager, storeId, dto.productId, dto.delta);
    });

    if (affected !== 1) {
      throw new ConflictException({
        code: 'INSUFFICIENT_INVENTORY',
        message: 'Adjustment would make stock negative',
        productId: dto.productId,
      });
    }

    const updated = await this.inventory.findOne(storeId, dto.productId);
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      priceCents: product.priceCents,
      isActive: product.isActive,
      quantityOnHand: updated?.quantityOnHand ?? 0,
    };
  }
}
