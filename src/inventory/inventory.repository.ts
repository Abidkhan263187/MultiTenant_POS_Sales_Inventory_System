import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Inventory } from '../database/entities';

@Injectable()
export class InventoryRepository {
  constructor(
    @InjectRepository(Inventory)
    private readonly inventory: Repository<Inventory>,
  ) {}

  private repo(manager?: EntityManager): Repository<Inventory> {
    return manager ? manager.getRepository(Inventory) : this.inventory;
  }

  findByStore(storeId: string): Promise<Inventory[]> {
    return this.inventory.find({ where: { storeId }, order: { productId: 'ASC' } });
  }

  findOne(storeId: string, productId: string, manager?: EntityManager): Promise<Inventory | null> {
    return this.repo(manager).findOne({ where: { storeId, productId } });
  }

  lockForUpdate(storeId: string, productIds: string[], manager: EntityManager): Promise<Inventory[]> {
    return this.repo(manager)
      .createQueryBuilder('inv')
      .setLock('pessimistic_write')
      .where('inv.storeId = :storeId', { storeId })
      .andWhere('inv.productId IN (:...productIds)', { productIds })
      .orderBy('inv.productId', 'ASC')
      .getMany();
  }

  async decrementIfEnough(
    manager: EntityManager,
    storeId: string,
    productId: string,
    quantity: number,
  ): Promise<number> {
    const result = await this.repo(manager)
      .createQueryBuilder()
      .update(Inventory)
      .set({
        quantityOnHand: () => `"quantity_on_hand" - ${quantity}`,
        updatedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('store_id = :storeId', { storeId })
      .andWhere('product_id = :productId', { productId })
      .andWhere('quantity_on_hand >= :quantity', { quantity })
      .execute();
    return result.affected ?? 0;
  }

  async applyDelta(
    manager: EntityManager,
    storeId: string,
    productId: string,
    delta: number,
  ): Promise<number> {
    const result = await this.repo(manager)
      .createQueryBuilder()
      .update(Inventory)
      .set({
        quantityOnHand: () => `"quantity_on_hand" + ${delta}`,
        updatedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('store_id = :storeId', { storeId })
      .andWhere('product_id = :productId', { productId })
      .andWhere(`quantity_on_hand + ${delta} >= 0`)
      .execute();
    return result.affected ?? 0;
  }
}
