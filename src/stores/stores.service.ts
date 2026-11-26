import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { Role } from '../common/enums';
import { Store } from '../database/entities';

@Injectable()
export class StoresRepository {
  constructor(
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
  ) {}

  findById(id: string): Promise<Store | null> {
    return this.stores.findOne({ where: { id } });
  }

  listForMerchant(merchantId: string): Promise<Store[]> {
    return this.stores.find({ where: { merchantId }, order: { name: 'ASC' } });
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
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Store not found' });
    }
    if (store.merchantId !== user.merchantId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: "You do not have access to this merchant's data",
      });
    }
    if (user.role !== Role.MERCHANT_ADMIN && user.storeId !== store.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to this store',
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
