import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../common/auth-user';
import { AuthService } from './auth.service';
import { UsersRepository } from './users.repository';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersRepository,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub?: string }): Promise<AuthUser> {
    if (!payload.sub) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid token' });
    }
    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid token' });
    }
    return this.auth.toAuthUser(user);
  }
}
