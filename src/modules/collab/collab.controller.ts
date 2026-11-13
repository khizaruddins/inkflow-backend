import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CollabService } from './collab.service';
import {
  InviteCollabDto,
  UpdateCollabPermissionDto,
  SetCollabModeDto,
  CreateSuggestionDto,
  ReviewSuggestionDto,
  BroadcastCollabEventDto,
} from './dto/collab.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CollabSuggestionStatus } from '@prisma/client';

@ApiTags('Collaboration')
@Controller('posts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CollabController {
  constructor(private readonly collabService: CollabService) {}

  @Get(':id/collab/state')
  @ApiOperation({ summary: 'Get collaboration mode, active settings, and participants' })
  async getCollabState(
    @Param('id') postId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.collabService.getCollabState(postId, userId, userRole);
  }

  @Post(':id/collab/invite')
  @ApiOperation({ summary: 'Invite a collaborator or regenerate the collaboration invite link' })
  async inviteCollaborator(
    @Param('id') postId: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: InviteCollabDto,
  ) {
    return this.collabService.inviteCollaborator(postId, actorId, userRole, dto);
  }

  @Delete(':id/collab/collaborators/:userId')
  @ApiOperation({ summary: 'Remove a collaborator from the story' })
  async removeCollaborator(
    @Param('id') postId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.collabService.removeCollaborator(postId, actorId, userRole, targetUserId);
  }

  @Patch(':id/collab/collaborators/:userId/permission')
  @ApiOperation({ summary: 'Update a collaborator permission (VIEW or EDIT)' })
  async updateCollaboratorPermission(
    @Param('id') postId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: UpdateCollabPermissionDto,
  ) {
    return this.collabService.updateCollaboratorPermission(
      postId,
      actorId,
      userRole,
      targetUserId,
      dto,
    );
  }

  @Post(':id/collab/regenerate-token')
  @ApiOperation({ summary: 'Regenerate the collaboration share link token' })
  async regenerateInviteToken(
    @Param('id') postId: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.collabService.regenerateInviteToken(postId, actorId, userRole);
  }

  @Post('collab/join/:inviteToken')
  @ApiOperation({ summary: 'Join a collaborative story session using an invitation token' })
  async joinByToken(
    @Param('inviteToken') inviteToken: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.collabService.joinByToken(inviteToken, userId);
  }

  @Patch(':id/collab/mode')
  @ApiOperation({ summary: 'Toggle collaboration mode (FREE_FLOW or APPROVAL_REQUIRED)' })
  async setCollabMode(
    @Param('id') postId: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: SetCollabModeDto,
  ) {
    return this.collabService.setCollabMode(postId, actorId, userRole, dto.mode);
  }

  @Get(':id/collab/suggestions')
  @ApiOperation({ summary: 'List proposed revision suggestions' })
  async listSuggestions(
    @Param('id') postId: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') userRole: string,
    @Query('status') status?: CollabSuggestionStatus,
  ) {
    return this.collabService.listSuggestions(postId, actorId, userRole, status);
  }

  @Post(':id/collab/suggestions')
  @ApiOperation({ summary: 'Submit a suggested change for author review (Mode 2)' })
  async submitSuggestion(
    @Param('id') postId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSuggestionDto,
  ) {
    return this.collabService.submitSuggestion(postId, userId, dto);
  }

  @Post(':id/collab/suggestions/:suggestionId/review')
  @ApiOperation({ summary: 'Author review (approve or reject) of a proposed suggestion' })
  async reviewSuggestion(
    @Param('id') postId: string,
    @Param('suggestionId') suggestionId: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: ReviewSuggestionDto,
  ) {
    return this.collabService.reviewSuggestion(
      postId,
      suggestionId,
      actorId,
      userRole,
      dto,
    );
  }

  @Post(':id/collab/event')
  @ApiOperation({ summary: 'Broadcast real-time editor events (content change, typing) to collaborators' })
  async broadcastEvent(
    @Param('id') postId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: BroadcastCollabEventDto,
  ) {
    return this.collabService.broadcastEvent(postId, userId, userRole, dto);
  }
}
