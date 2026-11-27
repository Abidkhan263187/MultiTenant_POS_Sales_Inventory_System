import { Module } from '@nestjs/common';
import { StoresModule } from '../stores/stores.module';
import {
  MerchantPaymentEventsController,
  StorePaymentEventsController,
} from './payment-events.controller';
import { PaymentEventsService } from './payment-events.service';

@Module({
  imports: [StoresModule],
  controllers: [MerchantPaymentEventsController, StorePaymentEventsController],
  providers: [PaymentEventsService],
})
export class PaymentEventsModule {}
