import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { StoreAccessGuard } from '../common/guards/store-access.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { InventoryService } from './inventory.service';

@Controller('stores/:storeId/inventory')
@UseGuards(JwtAuthGuard, StoreAccessGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(@Param('storeId', new ParseUUIDPipe({ version: '4' })) storeId: string) {
    return this.inventory.list(storeId);
  }

  @Post('adjustments')
  @Roles(Role.MERCHANT_ADMIN, Role.STORE_MANAGER)
  adjust(
    @Param('storeId', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @Body() dto: AdjustInventoryDto,
  ) {
    return this.inventory.adjust(storeId, dto);
  }
}
