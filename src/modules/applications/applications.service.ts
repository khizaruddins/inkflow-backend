import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

export interface CreateApplicationDto {
  sampleTitle: string;
  sampleContent: string;
  motivation: string;
}

@Injectable()
export class ApplicationsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateApplicationDto) {
    const existingPending = await this.prisma.creatorApplication.findFirst({
      where: { userId, status: 'PENDING' },
    });

    if (existingPending) {
      throw new BadRequestException('You already have a pending application under review.');
    }

    return this.prisma.creatorApplication.create({
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
    }

    return updatedApp;
  }
}
