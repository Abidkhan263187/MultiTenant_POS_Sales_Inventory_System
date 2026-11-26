import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/auth-user';
import { StoreAccessGuard } from '../common/guards/store-access.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { StoresService } from './stores.service';

@Controller('stores')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.stores.listForUser(user);
  }

  @Get(':storeId')
  @UseGuards(StoreAccessGuard)
  getOne(
    @CurrentUser() user: AuthUser,
    @Param('storeId', new ParseUUIDPipe({ version: '4' })) storeId: string,
  ) {
    return this.stores.getForUser(user, storeId);
  }
}
