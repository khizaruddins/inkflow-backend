import { Controller, Get, Post, Patch, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ApplicationsService, CreateApplicationDto } from './applications.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Creator Applications')
@Controller('applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ApplicationsController {
  constructor(private applicationsService: ApplicationsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit application to become a Creator/Writer' })
  async create(@Request() req: any, @Body() dto: CreateApplicationDto) {
    return this.applicationsService.create(req.user.id || req.user.sub, dto);
  }

  @Get('my-status')
  @ApiOperation({ summary: 'Get current user creator application status' })
  async getMyStatus(@Request() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.applicationsService.findByUserId(userId);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List all creator applications (Admin only)' })
  async findAll() {
    return this.applicationsService.findAll();
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Approve or reject creator application (Admin only)' })
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: 'APPROVED' | 'REJECTED',
  ) {
    return this.applicationsService.updateStatus(id, status);
  }
}
