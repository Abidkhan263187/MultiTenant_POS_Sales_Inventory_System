import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/auth-user';
import { Role } from '../common/enums';
import { RolesGuard } from '../common/guards/roles.guard';
import { StoreAccessGuard } from '../common/guards/store-access.guard';
import { ListPaymentEventsQueryDto } from './dto/list-payment-events.dto';
import { PaymentEventsService } from './payment-events.service';

@Controller('payment-events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.MERCHANT_ADMIN, Role.STORE_MANAGER)
export class MerchantPaymentEventsController {
  constructor(private readonly events: PaymentEventsService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.events.summaryForUser(user);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListPaymentEventsQueryDto) {
    return this.events.listForUser(user, query);
  }
}

@Controller('stores/:storeId/payment-events')
@UseGuards(JwtAuthGuard, StoreAccessGuard, RolesGuard)
@Roles(Role.MERCHANT_ADMIN, Role.STORE_MANAGER)
export class StorePaymentEventsController {
  constructor(private readonly events: PaymentEventsService) {}

  @Get('summary')
  summary(@Param('storeId', new ParseUUIDPipe({ version: '4' })) storeId: string) {
    return this.events.summaryForStore(storeId);
  }

  @Get()
  list(
    @Param('storeId', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @Query() query: ListPaymentEventsQueryDto,
  ) {
    return this.events.listForStore(storeId, query);
  }
}
