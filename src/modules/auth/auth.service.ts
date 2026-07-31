import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/database/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email }, { username: dto.username }],
      },
    });

    if (existingUser) {
      throw new ConflictException('User with this email or username already exists.');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const defaultAvatar = `https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80`;

    const userRole = (dto.role as Role) || Role.READER;

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        username: dto.username,
        avatar: defaultAvatar,
        role: userRole,
        masterPrivatePassword: hashedPassword,
        followingUserIds: [],
      },
    });

    const { masterPrivatePassword, ...userWithoutPassword } = user;
    const tokens = await this.generateTokens(user.id, user.email, user.role);

    return { user: userWithoutPassword, tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    if (user.masterPrivatePassword) {
      const isPasswordValid = await bcrypt.compare(dto.password, user.masterPrivatePassword);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid credentials.');
      }
    }

    const { masterPrivatePassword, ...userWithoutPassword } = user;
    const tokens = await this.generateTokens(user.id, user.email, user.role);

    return { user: userWithoutPassword, tokens };
  }

  async generateTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET') || 'inkflow_jwt_access_super_secret_key_2026',
      expiresIn: '15m',
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'inkflow_jwt_refresh_super_secret_key_2026',
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }
}
