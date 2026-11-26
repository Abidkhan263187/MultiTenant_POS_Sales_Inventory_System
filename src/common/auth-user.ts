import { Role } from './enums';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  merchantId: string;
  storeId: string | null;
}
