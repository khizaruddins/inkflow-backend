import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { NotificationType } from '@prisma/client';

export interface CreateApplicationDto {
  sampleTitle: string;
  sampleContent: string;
  motivation: string;
}

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateApplicationDto) {
    const existingPending = await this.prisma.creatorApplication.findFirst({
      where: { userId, status: 'PENDING' },
    });

    if (existingPending) {
      throw new BadRequestException('You already have a pending application under review.');
    }

    const application = await this.prisma.creatorApplication.create({
      data: {
        userId,
        sampleTitle: dto.sampleTitle,
        sampleContent: dto.sampleContent,
        motivation: dto.motivation,
        status: 'PENDING',
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            role: true,
          },
        },
      },
    });

    // Notify all platform admins
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true },
      });
      if (admins.length > 0) {
        await this.prisma.notification.createMany({
          data: admins.map((admin) => ({
            recipientId: admin.id,
            actorId: userId,
            type: NotificationType.EDITORIAL_FLAG,
            message: `✍️ Creator Application: "${dto.sampleTitle}" submitted by ${application.user?.name || 'Reader'} for writer review.`,
            read: false,
          })),
        });
      }
    } catch (err) {
      this.logger.error('Failed to notify admins of creator application', err);
    }

    return application;
  }

  async findByUserId(userId: string) {
    return this.prisma.creatorApplication.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });
  }

  async findAll() {
    return this.prisma.creatorApplication.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            role: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async updateStatus(id: string, status: 'APPROVED' | 'REJECTED') {
    const app = await this.prisma.creatorApplication.findUnique({
      where: { id },
    });

    if (!app) {
      throw new NotFoundException('Application not found');
    }

    const updatedApp = await this.prisma.creatorApplication.update({
      where: { id },
      data: { status },
      include: {
        user: true,
      },
    });

    // If approved, update user's role in database to WRITER!
    if (status === 'APPROVED') {
      await this.prisma.user.update({
        where: { id: app.userId },
        data: { role: 'WRITER' },
      });

      try {
        await this.prisma.notification.create({
          data: {
            recipientId: app.userId,
            actorId: app.userId,
            type: 'FOLLOW',
          },
        });
      } catch {}
    }

    return updatedApp;
  }
}
