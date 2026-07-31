import { Controller, Get, Delete, Patch, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ReportsService } from './reports.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Reports')
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all reported responses under evaluation (Admin only)' })
  async findAll() {
    return this.reportsService.findAll();
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete reported response from platform (Admin only)' })
  async deleteReportedComment(@Param('id') id: string) {
    return this.reportsService.deleteReportedComment(id);
  }

  @Patch(':id/dismiss')
  @ApiOperation({ summary: 'Dismiss report flag (Admin only)' })
  async dismissReport(@Param('id') id: string) {
    return this.reportsService.dismissReport(id);
  }
}
