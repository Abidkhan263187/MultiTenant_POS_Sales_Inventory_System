import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/auth-user';
import { StoreAccessGuard } from '../common/guards/store-access.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { SaleStatus } from '../common/enums';
import { CreateSaleDto, ListSalesQueryDto } from './dto/sale.dto';
import { SalesService } from './sales.service';

@Controller(['stores/:storeId/sales', 'stores/:storeId/orders'])
@UseGuards(JwtAuthGuard, StoreAccessGuard, RolesGuard)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  list(
    @Param('storeId', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @Query() query: ListSalesQueryDto,
  ) {
    return this.sales.list(storeId, query);
  }

  @Get(':saleId')
  getOne(
    @Param('storeId', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @Param('saleId', new ParseUUIDPipe({ version: '4' })) saleId: string,
  ) {
    return this.sales.getOne(storeId, saleId);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Param('storeId', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @Body() dto: CreateSaleDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.sales.create(user, storeId, dto, idempotencyKey);
    if (result.replayed) {
      res.status(200);
    } else if (result.sale.status === SaleStatus.FAILED) {
      res.status(402);
    } else {
      res.status(201);
    }
    return result.sale;
  }
}
