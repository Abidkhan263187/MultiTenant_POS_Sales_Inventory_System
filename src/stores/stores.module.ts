import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreAccessGuard } from '../common/guards/store-access.guard';
import { Store } from '../database/entities';
import { StoresController } from './stores.controller';
import { StoresRepository, StoresService } from './stores.service';

@Module({
  imports: [TypeOrmModule.forFeature([Store])],
  controllers: [StoresController],
  providers: [StoresRepository, StoresService, StoreAccessGuard],
  exports: [StoresService, StoreAccessGuard],
})
export class StoresModule {}
