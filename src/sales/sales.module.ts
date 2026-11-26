import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment, Sale, SaleItem } from '../database/entities';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProductsModule } from '../products/products.module';
import { StoresModule } from '../stores/stores.module';
import { SalesController } from './sales.controller';
import { SalesRepository } from './sales.repository';
import { SalesService } from './sales.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Sale, SaleItem, Payment]),
    StoresModule,
    ProductsModule,
    InventoryModule,
    PaymentsModule,
  ],
  controllers: [SalesController],
  providers: [SalesRepository, SalesService],
})
export class SalesModule {}
