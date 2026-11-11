import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/database/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request) => {
          const token = ExtractJwt.fromAuthHeaderAsBearerToken()(request);
          if (!token || token === 'null' || token === 'undefined') {
            return null;
          }
          return token;
        },
        (request) => {
          const cookieToken = request?.cookies?.accessToken;
          if (!cookieToken || cookieToken === 'null' || cookieToken === 'undefined') {
            return null;
          }
          return cookieToken;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET') || 'inkflow_jwt_access_super_secret_key_2026',
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        avatar: true,
        role: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found or token revoked.');
    }

    return user;
  }
}
