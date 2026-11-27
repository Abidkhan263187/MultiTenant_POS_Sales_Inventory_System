import { ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { Role } from '../common/enums';
import { Store } from '../database/entities';

@Injectable()
export class StoresRepository implements OnModuleInit {
  private readonly cache = new Map<string, Store>();
  private loadedAt = 0;
  private refreshing: Promise<void> | null = null;

  constructor(
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  async findById(id: string): Promise<Store | null> {
    await this.ensure(id);
    return this.cache.get(id) ?? null;
  }

  async listForMerchant(merchantId: string): Promise<Store[]> {
    await this.ensure();
    return [...this.cache.values()]
      .filter((store) => store.merchantId === merchantId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async ensure(id?: string): Promise<void> {
    const fresh = this.loadedAt > 0 && Date.now() - this.loadedAt < 60_000;
    if (fresh && (!id || this.cache.has(id))) {
      return;
    }
    await this.refresh();
  }

  private refresh(): Promise<void> {
    if (this.refreshing) {
      return this.refreshing;
    }
    this.refreshing = this.stores
      .find()
      .then((rows) => {
        this.cache.clear();
        for (const row of rows) {
          this.cache.set(row.id, row);
        }
        this.loadedAt = Date.now();
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
}

@Injectable()
export class StoresService {
  constructor(private readonly stores: StoresRepository) {}

  async listForUser(user: AuthUser) {
    if (user.role === Role.MERCHANT_ADMIN) {
      const rows = await this.stores.listForMerchant(user.merchantId);
      return rows.map(toStoreView);
    }
    if (!user.storeId) {
      return [];
    }
    const store = await this.stores.findById(user.storeId);
    return store ? [toStoreView(store)] : [];
  }

  async getForUser(user: AuthUser, storeId: string) {
    const store = await this.requireAccess(user, storeId);
    return toStoreView(store);
  }

  async requireAccess(user: AuthUser, storeId: string): Promise<Store> {
    const store = await this.stores.findById(storeId);
    if (!store) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That store was not found.' });
    }
    if (store.merchantId !== user.merchantId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'This store belongs to another business. You can only open your own stores.',
      });
    }
    if (user.role !== Role.MERCHANT_ADMIN && user.storeId !== store.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only use your own store.',
      });
    }
    return store;
  }
}

export function toStoreView(store: Store) {
  return {
    id: store.id,
    merchantId: store.merchantId,
    name: store.name,
    createdAt: store.createdAt,
  };
}
