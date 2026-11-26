import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { RedisCacheModule } from './cache/redis-cache.module';
import { typeOrmConfig } from './database/typeorm-options';
import { HealthController } from './health/health.controller';
import { InventoryModule } from './inventory/inventory.module';
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
    SalesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
