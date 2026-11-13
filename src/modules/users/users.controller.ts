import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Role } from '@prisma/client';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get all platform users with roles and stats' })
  async getUsers() {
    return this.usersService.findAll();
  }

  @Post('pause')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pause current authenticated user account' })
  async pauseAccount(@CurrentUser('id') userId: string) {
    return this.usersService.pauseAccount(userId);
  }

  @Post('unpause')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unpause current authenticated user account' })
  async unpauseAccount(@CurrentUser('id') userId: string) {
    return this.usersService.unpauseAccount(userId);
  }

  @Post('request-deletion')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request scheduled account deletion with 30-day grace period' })
  async requestDeletion(
    @CurrentUser('id') userId: string,
    @Body('email') email: string,
  ) {
    return this.usersService.requestAccountDeletion(userId, email);
  }

  @Post('cancel-deletion')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel pending scheduled account deletion' })
  async cancelDeletion(@CurrentUser('id') userId: string) {
    return this.usersService.cancelAccountDeletion(userId);
  }

  @Get('admin/deletion-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all account deletion requests (Admin only)' })
  async getDeletionRequests() {
    return this.usersService.getDeletionRequests();
  }

  @Patch('admin/:id/suspend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Suspend a user account (Admin only)' })
  async suspendUser(
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.usersService.suspendUser(id, reason);
  }

  @Patch('admin/:id/unsuspend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unsuspend a user account (Admin only)' })
  async unsuspendUser(@Param('id') id: string) {
    return this.usersService.unsuspendUser(id);
  }

  @Delete('admin/:id/hard-delete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Permanently wipe user and all data from MongoDB (Admin only)' })
  async hardDeleteUser(@Param('id') id: string) {
    return this.usersService.hardDeleteUser(id);
  }
}
