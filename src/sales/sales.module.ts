import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { StoresModule } from '../stores/stores.module';
import { SalesController } from './sales.controller';
import { SalesRepository } from './sales.repository';
import { SalesService } from './sales.service';

@Module({
  imports: [StoresModule, PaymentsModule],
  controllers: [SalesController],
  providers: [SalesRepository, SalesService],
})
export class SalesModule {}
