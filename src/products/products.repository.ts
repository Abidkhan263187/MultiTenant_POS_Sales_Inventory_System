import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Product } from '../database/entities';

@Injectable()
export class ProductsRepository {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  private repo(manager?: EntityManager): Repository<Product> {
    return manager ? manager.getRepository(Product) : this.products;
  }

  findByStore(storeId: string): Promise<Product[]> {
    return this.products.find({ where: { storeId }, order: { name: 'ASC' } });
  }

  findInStore(storeId: string, productId: string): Promise<Product | null> {
    return this.products.findOne({ where: { id: productId, storeId } });
  }

  findBySku(storeId: string, sku: string, manager?: EntityManager): Promise<Product | null> {
    return this.repo(manager).findOne({ where: { storeId, sku } });
  }

  findActiveInStore(storeId: string, productIds: string[], manager: EntityManager): Promise<Product[]> {
    return this.repo(manager).find({
      where: { storeId, id: In(productIds), isActive: true },
    });
  }

  save(product: Partial<Product>, manager?: EntityManager): Promise<Product> {
    return this.repo(manager).save(this.repo(manager).create(product));
  }
}
