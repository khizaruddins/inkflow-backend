import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/database/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    try {
      await this.prisma.user.upsert({
        where: { email: 'admin@gmail.com' },
        update: {
          masterPrivatePassword: 'Khizar@123',
          role: Role.ADMIN,
        },
        create: {
          email: 'admin@gmail.com',
          name: 'Admin User',
          username: 'admin',
          avatar: 'https://ui-avatars.com/api/?name=Admin+User&background=059669&color=fff',
          bio: 'InkFlow Administrator',
          role: Role.ADMIN,
          masterPrivatePassword: 'Khizar@123',
          followingUserIds: [],
        },
      });
      console.log('✅ Admin user admin@gmail.com reset with password Khizar@123');
    } catch (e) {
      console.error('Failed to init admin user:', e);
    }
  }

  private generateTokens(user: { id: string; email: string; role: Role }) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessSecret =
      this.configService.get<string>('JWT_ACCESS_SECRET') ||
      'inkflow_jwt_access_super_secret_key_2026';
    const refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ||
      'inkflow_jwt_refresh_super_secret_key_2026';
    const accessExpiresIn =
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN', '7d') || '7d';
    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '30d') || '30d';

    const accessToken = this.jwtService.sign(payload, {
      secret: accessSecret,
      expiresIn: accessExpiresIn as any,
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: refreshSecret,
      expiresIn: refreshExpiresIn as any,
    });

    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email }, { username: dto.username }],
      },
    });

    if (existing) {
      throw new ConflictException('User with this email or username already exists.');
    }

    const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(dto.name)}&background=random`;

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        username: dto.username,
        avatar: defaultAvatar,
        role: dto.role || Role.READER,
        masterPrivatePassword: dto.password,
      },
    });

    const tokens = this.generateTokens(user);
    const { masterPrivatePassword, ...userWithoutPassword } = user;
    return { user: userWithoutPassword, tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const isMatch = user.masterPrivatePassword === dto.password;
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const tokens = this.generateTokens(user);
    const { masterPrivatePassword, ...userWithoutPassword } = user;
    return { user: userWithoutPassword, tokens };
  }

  async resetPassword(dto: { email: string; newPassword: string }) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email.trim(), mode: 'insensitive' },
      },
    });

    if (!user) {
      throw new NotFoundException('No account found with this email address.');
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        masterPrivatePassword: dto.newPassword,
      },
    });

    const { masterPrivatePassword, ...userWithoutPassword } = updated;
    return { success: true, message: 'Password reset successfully.', user: userWithoutPassword };
  }

  async refreshTokens(refreshToken: string) {
    try {
      const refreshSecret =
        this.configService.get<string>('JWT_REFRESH_SECRET') ||
        'inkflow_jwt_refresh_super_secret_key_2026';
      const payload = this.jwtService.verify(refreshToken, { secret: refreshSecret });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new UnauthorizedException('User not found.');
      }

      const tokens = this.generateTokens(user);
      const { masterPrivatePassword, ...userWithoutPassword } = user;
      return { user: userWithoutPassword, tokens };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
  }

  async getUserMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    const { masterPrivatePassword, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async getUserByUsername(username: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: username, mode: 'insensitive' } },
          { id: username },
        ],
      },
      include: {
        posts: {
          where: { status: 'PUBLISHED' },
          orderBy: { publishedAt: 'desc' },
          include: {
            category: true,
            tags: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User @${username} not found`);
    }

    const { masterPrivatePassword, ...publicUser } = user;
    return publicUser;
  }

  async getUserFollowers(userIdOrUsername: string) {
    let targetUserId = userIdOrUsername;
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: userIdOrUsername }, { username: userIdOrUsername }],
      },
    });

    if (user) {
      targetUserId = user.id;
    }

    const followers = await this.prisma.user.findMany({
      where: {
        followingUserIds: {
          has: targetUserId,
        },
      },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        bio: true,
        role: true,
        followersCount: true,
        followingCount: true,
        createdAt: true,
      },
    });

    return followers;
  }

  async getUserFollowing(userIdOrUsername: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: userIdOrUsername }, { username: userIdOrUsername }],
      },
    });

    if (!user) {
      return [];
    }

    if (!user.followingUserIds || user.followingUserIds.length === 0) {
      return [];
    }

    const following = await this.prisma.user.findMany({
      where: {
        id: {
          in: user.followingUserIds,
        },
      },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        bio: true,
        role: true,
        followersCount: true,
        followingCount: true,
        createdAt: true,
      },
    });

    return following;
  }

  async toggleFollowUser(currentUserId: string, targetUserId: string) {
    if (currentUserId === targetUserId) {
      throw new BadRequestException('You cannot follow yourself.');
    }

    const [currentUser, targetUser] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: currentUserId } }),
      this.prisma.user.findUnique({ where: { id: targetUserId } }),
    ]);

    if (!targetUser) {
      throw new NotFoundException('User to follow not found.');
    }

    const isFollowing = currentUser?.followingUserIds?.includes(targetUserId);

    if (isFollowing) {
      const updatedFollowing = (currentUser?.followingUserIds || []).filter(
        (id) => id !== targetUserId,
      );
      await this.prisma.user.update({
        where: { id: currentUserId },
        data: {
          followingUserIds: updatedFollowing,
          followingCount: { decrement: 1 },
        },
      });
      await this.prisma.user.update({
        where: { id: targetUserId },
        data: { followersCount: { decrement: 1 } },
      });

      return {
        following: false,
        followingUserIds: updatedFollowing,
        targetUser: { id: targetUser.id, name: targetUser.name, username: targetUser.username },
      };
    } else {
      const updatedFollowing = [...(currentUser?.followingUserIds || []), targetUserId];
      await this.prisma.user.update({
        where: { id: currentUserId },
        data: {
          followingUserIds: updatedFollowing,
          followingCount: { increment: 1 },
        },
      });
      await this.prisma.user.update({
        where: { id: targetUserId },
        data: { followersCount: { increment: 1 } },
      });

      try {
        // Notify the followed user
        await this.prisma.notification.create({
          data: {
            recipientId: targetUserId,
            actorId: currentUserId,
            type: 'FOLLOW',
          },
        });
      } catch (e) {
        // Quietly handle notification error if duplicate
      }

      try {
        // Notify the current follower
        await this.prisma.notification.create({
          data: {
            recipientId: currentUserId,
            actorId: targetUserId,
            type: 'FOLLOW',
          },
        });
      } catch (e) {
        // Quietly handle notification error if duplicate
      }

      return {
        following: true,
        followingUserIds: updatedFollowing,
        targetUser: { id: targetUser.id, name: targetUser.name, username: targetUser.username },
      };
    }
  }
}
