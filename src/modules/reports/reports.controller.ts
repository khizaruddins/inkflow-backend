import { Controller, Get, Post, Delete, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ReportsService } from './reports.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Reports')
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  // --------------------------------------------------------------------------
  // Comment Reports
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // Post (Story) Reports
  // --------------------------------------------------------------------------

  @Get('posts')
  @ApiOperation({ summary: 'Get all reported blog stories under evaluation (Admin only)' })
  async findAllPostReports() {
    return this.reportsService.findAllPostReports();
  }

  @Delete('posts/:id')
  @ApiOperation({ summary: 'Take down and delete reported blog story (Admin only)' })
  async deleteReportedPost(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.reportsService.deleteReportedPost(id, adminId);
  }

  @Post('posts/:id/warn')
  @ApiOperation({ summary: 'Send admin warning note to author of reported story (Admin only)' })
  async warnAuthor(
    @Param('id') id: string,
    @Body('comment') comment: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.reportsService.warnPostAuthor(id, comment, adminId);
  }

  @Patch('posts/:id/dismiss')
  @ApiOperation({ summary: 'Dismiss post report flag (Admin only)' })
  async dismissPostReport(@Param('id') id: string) {
    return this.reportsService.dismissPostReport(id);
  }
}
