import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthUser } from '../common/auth-user';
import { LoginDto } from './dto/login.dto';
import { UsersRepository } from './users.repository';

interface JwtPayload {
  sub: string;
  email: string;
  fullName: string;
  role: AuthUser['role'];
  merchantId: string;
  storeId: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users.findByEmail(email);
    const passwordMatches = user ? await bcrypt.compare(dto.password, user.passwordHash) : false;
    if (!user || !passwordMatches) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'The email or password is incorrect.',
      });
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      merchantId: user.merchantId,
      storeId: user.storeId,
    };
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN', '12h');
    const accessToken = await this.jwt.signAsync(payload);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      user: this.toAuthUser(user),
    };
  }

  toAuthUser(user: {
    id: string;
    email: string;
    fullName: string;
    role: AuthUser['role'];
    merchantId: string;
    storeId: string | null;
  }): AuthUser {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      merchantId: user.merchantId,
      storeId: user.storeId,
    };
  }
}
