import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CacheStatus, RedisCacheService } from '../cache/redis-cache.service';
import { isUniqueViolation } from '../common/postgres-error';
import { Inventory, Product } from '../database/entities';
import { formatInr } from '../common/money';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductsRepository } from './products.repository';

export interface ProductView {
  id: string;
  storeId: string;
  sku: string;
  name: string;
  priceCents: number;
  priceLabel: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly dataSource: DataSource,
    private readonly cache: RedisCacheService,
    private readonly config: ConfigService,
  ) {}

  async list(storeId: string): Promise<{ items: ProductView[]; cache: CacheStatus }> {
    const key = this.cacheKey(storeId);
    const cached = await this.cache.get(key);
    if (cached) {
      return { items: JSON.parse(cached) as ProductView[], cache: 'HIT' };
    }

    const items = (await this.products.findByStore(storeId)).map(toProductView);
    const stored = await this.cache.set(key, JSON.stringify(items), this.ttl());
    return { items, cache: stored ? 'MISS' : 'BYPASS' };
  }

  async getOne(storeId: string, productId: string): Promise<ProductView> {
    const product = await this.products.findInStore(storeId, productId);
    if (!product) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'That product was not found in this store.',
      });
    }
    return toProductView(product);
  }

  async create(storeId: string, dto: CreateProductDto): Promise<ProductView> {
    const sku = dto.sku.trim();
    const name = dto.name.trim();
    const existing = await this.products.findBySku(storeId, sku);
    if (existing) {
      throw new ConflictException({
        code: 'SKU_EXISTS',
        message: `SKU ${sku} is already used in this store. Choose a different SKU.`,
      });
    }

    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const product = await this.products.save(
          {
            storeId,
            sku,
            name,
            priceCents: dto.priceCents,
            isActive: true,
          },
          manager,
        );
        await manager.getRepository(Inventory).save(
          manager.getRepository(Inventory).create({
            storeId,
            productId: product.id,
            quantityOnHand: dto.initialQuantity,
          }),
        );
        return product;
      });
      await this.cache.del(this.cacheKey(storeId));
      return toProductView(saved);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'SKU_EXISTS',
          message: `SKU ${sku} is already used in this store. Choose a different SKU.`,
        });
      }
      throw error;
    }
  }

  async update(storeId: string, productId: string, dto: UpdateProductDto): Promise<ProductView> {
    if (dto.name === undefined && dto.priceCents === undefined && dto.isActive === undefined) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Choose at least one change: name, price, or whether the product is for sale.',
      });
    }

    const product = await this.products.findInStore(storeId, productId);
    if (!product) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'That product was not found in this store.',
      });
    }

    if (dto.name !== undefined) {
      product.name = dto.name.trim();
    }
    if (dto.priceCents !== undefined) {
      product.priceCents = dto.priceCents;
    }
    if (dto.isActive !== undefined) {
      product.isActive = dto.isActive;
    }

    const saved = await this.products.save(product);
    await this.cache.del(this.cacheKey(storeId));
    return toProductView(saved);
  }

  private cacheKey(storeId: string): string {
    return `pos:products:${storeId}`;
  }

  private ttl(): number {
    const configured = Number(this.config.get<string>('CACHE_TTL_SECONDS', '60'));
    return Number.isFinite(configured) && configured > 0 ? configured : 60;
  }
}

export function toProductView(product: Product): ProductView {
  return {
    id: product.id,
    storeId: product.storeId,
    sku: product.sku,
    name: product.name,
    priceCents: product.priceCents,
    priceLabel: formatInr(product.priceCents),
    isActive: product.isActive,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}
