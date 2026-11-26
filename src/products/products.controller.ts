import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { StoreAccessGuard } from '../common/guards/store-access.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductsService } from './products.service';

@Controller('stores/:storeId/products')
@UseGuards(JwtAuthGuard, StoreAccessGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  async list(
    @Param('storeId', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.products.list(storeId);
    res.setHeader('X-Cache', result.cache);
    return result.items;
  }

  @Get(':productId')
  getOne(
    @Param('storeId', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
  ) {
    return this.products.getOne(storeId, productId);
  }

  @Post()
  @Roles(Role.MERCHANT_ADMIN, Role.STORE_MANAGER)
  create(
    @Param('storeId', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.products.create(storeId, dto);
  }

  @Patch(':productId')
  @Roles(Role.MERCHANT_ADMIN, Role.STORE_MANAGER)
  update(
    @Param('storeId', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(storeId, productId, dto);
  }
}
