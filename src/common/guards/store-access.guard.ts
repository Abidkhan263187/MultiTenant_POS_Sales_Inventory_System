import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { StoresService } from '../../stores/stores.service';
import { AuthUser } from '../auth-user';

@Injectable()
export class StoreAccessGuard implements CanActivate {
  constructor(private readonly stores: StoresService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const storeId = request.params?.storeId as string | undefined;
    if (!storeId) {
      return true;
    }
    const user = request.user as AuthUser;
    request.store = await this.stores.requireAccess(user, storeId);
    return true;
  }
}
