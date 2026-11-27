import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitGuard } from './common/rate-limit.guard';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { RedisCacheModule } from './cache/redis-cache.module';
import { typeOrmConfig } from './database/typeorm-options';
import { HealthController } from './health/health.controller';
import { InventoryModule } from './inventory/inventory.module';
import { PaymentEventsModule } from './payment-events/payment-events.module';
import { PaymentsModule } from './payments/payments.module';
import { ProductsModule } from './products/products.module';
import { SalesModule } from './sales/sales.module';
import { StoresModule } from './stores/stores.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => {
        if (!config.DATABASE_URL) {
          throw new Error('DATABASE_URL is required');
        }
        if (!config.JWT_SECRET) {
          throw new Error('JWT_SECRET is required');
        }
        return config;
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => ({
        ...typeOrmConfig(),
        autoLoadEntities: true,
      }),
    }),
    RedisCacheModule,
    AuthModule,
    StoresModule,
    ProductsModule,
    InventoryModule,
    PaymentsModule,
    PaymentEventsModule,
    SalesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class AppModule {}
