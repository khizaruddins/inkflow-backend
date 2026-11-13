import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PostsService } from './posts.service';
import { PrivatePostsService, ViewerContext } from './private-posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { SaveDraftDto } from './dto/save-draft.dto';
import {
  GrantPrivateAccessDto,
  RecordPostViewDto,
  UpdatePrivateAccessDto,
  UpdatePrivateSettingsDto,
  VerifyPrivatePasswordDto,
} from './dto/private-post.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ReportsService } from '../reports/reports.service';

@ApiTags('Posts')
@Controller('posts')
export class PostsController {
  constructor(
    private postsService: PostsService,
    private privatePostsService: PrivatePostsService,
    private reportsService: ReportsService,
  ) {}

  private buildViewerContext(
    currentUser?: any,
    shareToken?: string,
    unlockToken?: string,
    req?: any,
  ): ViewerContext {
    return {
      userId: currentUser?.id || currentUser?.sub || null,
      userRole: currentUser?.role || null,
      shareToken: shareToken || null,
      unlockToken: unlockToken || null,
      jwtAuthFailed: Boolean(req?.jwtAuthFailed),
    };
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  @ApiOperation({
    summary:
      'Get published public articles feed with search, status, feed (following), and isFeatured filters (excludes private blogs from public listings)',
  })
  async findAll(
    @Query('status') status?: string,
    @Query('visibility') visibility?: string,
    @Query('includePrivate') includePrivate?: string,
    @Query('categoryId') categoryId?: string,
    @Query('authorId') authorId?: string,
    @Query('search') search?: string,
    @Query('feed') feed?: string,
    @Query('isFeatured') isFeatured?: string,
    @CurrentUser() currentUser?: any,
    @Req() req?: any,
  ) {
    return this.postsService.findAll({
      status,
      visibility,
      includePrivate: includePrivate === 'true',
      categoryId,
      authorId,
      search,
      feed,
      isFeatured: isFeatured === 'true',
      currentUserId: currentUser?.id,
      currentUserRole: currentUser?.role,
      jwtAuthFailed: Boolean(req?.jwtAuthFailed),
    });
  }

  @Get('private/mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all private blogs owned by the authenticated user' })
  async getMyPrivatePosts(@CurrentUser('id') authorId: string) {
    return this.privatePostsService.getMyPrivatePosts(authorId);
  }

  @Get('private/shared-with-me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get private blogs shared with the authenticated reader' })
  async getSharedWithMePosts(@CurrentUser('id') userId: string) {
    return this.privatePostsService.getSharedWithMePosts(userId);
  }

  @Get('private/admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all private blogs across platform (Admin only)' })
  async getAdminPrivatePosts() {
    return this.privatePostsService.getAdminPrivatePosts();
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('private/share/:shareToken')
  @ApiOperation({ summary: 'Access a private blog via its secret shareToken URL' })
  async findByShareToken(
    @Param('shareToken') shareToken: string,
    @Query('unlockToken') unlockTokenQuery?: string,
    @Headers('x-private-unlock-token') unlockTokenHeader?: string,
    @CurrentUser() currentUser?: any,
    @Req() req?: any,
  ) {
    return this.postsService.findByShareToken(
      shareToken,
      this.buildViewerContext(currentUser, shareToken, unlockTokenHeader || unlockTokenQuery, req),
    );
  }

  @Post('draft')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Save story content as a draft (Private drafts allowed for any user)' })
  async saveDraft(
    @CurrentUser('id') authorId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: SaveDraftDto,
  ) {
    return this.postsService.saveDraft(authorId, dto, userRole);
  }

  @Post('bulk-delete')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk delete owned posts by IDs (Admin can delete any)' })
  async bulkDelete(
    @Body('ids') ids: string[],
    @CurrentUser('id') currentUserId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.postsService.bulkDelete(ids, currentUserId, userRole);
  }

  @Post('bulk-publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.WRITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk publish non-private posts by IDs (Writer / Admin only)' })
  async bulkPublish(
    @Body('ids') ids: string[],
    @CurrentUser('id') currentUserId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.postsService.bulkPublish(ids, currentUserId, userRole);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Create a new blog post (Public posts require Writer/Admin; Private blogs allowed for any authenticated user)',
  })
  async create(
    @CurrentUser('id') authorId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: CreatePostDto,
  ) {
    if (dto.id) {
      return this.postsService.updatePost(dto.id, authorId, dto, userRole);
    }
    return this.postsService.create(authorId, dto, userRole);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a single post by ID (Author or Admin)' })
  async deletePost(
    @Param('id') id: string,
    @CurrentUser('id') currentUserId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.postsService.deletePost(id, currentUserId, userRole);
  }

  @Post(':id/feature')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle post isFeatured status (Admin only, non-private posts)' })
  async toggleFeature(@Param('id') id: string) {
    return this.postsService.toggleFeature(id);
  }

  @Get(':id/private-settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get private blog settings, shared access list, and author followers with access status',
  })
  async getPrivateSettings(
    @Param('id') id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
  ) {
    return this.privatePostsService.getPrivateSettings(id, actorId, actorRole);
  }

  @Patch(':id/private-settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update private blog password/PIN, lock type, follow/link rules, or rotate shareToken',
  })
  async updatePrivateSettings(
    @Param('id') id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Body() dto: UpdatePrivateSettingsDto,
  ) {
    return this.privatePostsService.updatePrivateSettings(id, actorId, actorRole, dto);
  }

  @Get(':id/private-access/followers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List author followers with their private blog access status' })
  async getFollowersForSharing(
    @Param('id') id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Query('search') search?: string,
  ) {
    return this.privatePostsService.getFollowersForSharing(id, actorId, actorRole, search);
  }

  @Get(':id/private-access/users')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search all readers/users for private blog sharing (shows follower/follow-first status)' })
  async searchUsersForSharing(
    @Param('id') id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Query('search') search?: string,
  ) {
    return this.privatePostsService.searchUsersForSharing(id, actorId, actorRole, search);
  }

  @Get(':id/private-access')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get list of all users who have shared access to this private blog' })
  async getSharedAccessList(
    @Param('id') id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Query('status') status?: string,
  ) {
    return this.privatePostsService.getSharedAccessList(id, actorId, actorRole, status);
  }

  @Post(':id/private-access')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Grant private blog access to a follower or followed reader (supports one-time view and per-user PIN/password)',
  })
  async grantPrivateAccess(
    @Param('id') id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Body() dto: GrantPrivateAccessDto,
  ) {
    return this.privatePostsService.grantPrivateAccess(id, actorId, actorRole, dto);
  }

  @Patch(':id/private-access/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a specific reader private access settings (one-time view, password, reset view, restore)',
  })
  async updatePrivateAccess(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Body() dto: UpdatePrivateAccessDto,
  ) {
    return this.privatePostsService.updatePrivateAccess(id, targetUserId, actorId, actorRole, dto);
  }

  @Delete(':id/private-access/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke private blog access for a specific reader' })
  async revokePrivateAccess(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
  ) {
    return this.privatePostsService.revokePrivateAccess(id, targetUserId, actorId, actorRole);
  }

  @Post(':id/private-access/:userId/revoke')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke private blog access for a specific reader (POST alias)' })
  async revokePrivateAccessPost(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
  ) {
    return this.privatePostsService.revokePrivateAccess(id, targetUserId, actorId, actorRole);
  }

  @Get(':id/edit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Fetch full story data for editing (Author or Admin)',
  })
  async getPostForEdit(
    @Param('id') id: string,
    @CurrentUser('id') authorId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.postsService.getPostForEdit(id, authorId, userRole);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':slugOrId')
  @ApiOperation({
    summary: 'Fetch single story details by slug or ObjectId (enforces private blog access & lock gates)',
  })
  async findOne(
    @Param('slugOrId') slugOrId: string,
    @Query('shareToken') shareTokenQuery?: string,
    @Query('token') tokenQuery?: string,
    @Query('share') shareQuery?: string,
    @Query('unlockToken') unlockTokenQuery?: string,
    @Headers('x-share-token') shareTokenHeader?: string,
    @Headers('x-private-unlock-token') unlockTokenHeader?: string,
    @CurrentUser() currentUser?: any,
    @Req() req?: any,
  ) {
    return this.postsService.findBySlugOrId(
      slugOrId,
      this.buildViewerContext(
        currentUser,
        shareTokenHeader || shareTokenQuery || tokenQuery || shareQuery,
        unlockTokenHeader || unlockTokenQuery,
        req,
      ),
    );
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an existing story by ID (Author only)' })
  async replacePost(
    @Param('id') id: string,
    @CurrentUser('id') authorId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: any,
  ) {
    return this.postsService.updatePost(id, authorId, dto, userRole);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Partially update an existing story by ID (Author only)' })
  async updatePost(
    @Param('id') id: string,
    @CurrentUser('id') authorId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: any,
  ) {
    return this.postsService.updatePost(id, authorId, dto, userRole);
  }

  @Post(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an existing story by ID (POST alias, Author only)' })
  async updatePostPost(
    @Param('id') id: string,
    @CurrentUser('id') authorId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: any,
  ) {
    return this.postsService.updatePost(id, authorId, dto, userRole);
  }

  @Get(':id/clappers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get list of users who clapped for a story (Authenticated users only)',
  })
  async getClappers(
    @Param('id') id: string,
    @Headers('x-share-token') shareToken?: string,
    @Headers('x-private-unlock-token') unlockToken?: string,
    @CurrentUser() currentUser?: any,
  ) {
    return this.postsService.getClappers(
      id,
      this.buildViewerContext(currentUser, shareToken, unlockToken),
    );
  }

  @Post(':id/clap')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clap for a story (Authenticated readers only)' })
  async clap(
    @Param('id') id: string,
    @CurrentUser() currentUser: any,
    @Body('count') count?: number,
    @Headers('x-share-token') shareToken?: string,
    @Headers('x-private-unlock-token') unlockToken?: string,
  ) {
    return this.postsService.clap(
      id,
      currentUser.id,
      count || 1,
      this.buildViewerContext(currentUser, shareToken, unlockToken),
    );
  }

  @Post(':id/submit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit story for Admin editorial review (Non-private posts only)' })
  async submitForReview(@Param('id') id: string, @CurrentUser('id') authorId: string) {
    return this.postsService.submitForReview(id, authorId);
  }

  @Post(':id/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Admin review action: Approve, Request Revisions, Flag as Improper (convert to DRAFT + notify), or Reject (Admin only)',
  })
  async reviewPost(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Body('status') status: 'PUBLISHED' | 'NEEDS_REVISION' | 'REJECTED' | 'DRAFT',
    @Body('feedback') feedback?: string,
    @Body('action') action?: string,
  ) {
    return this.postsService.reviewPost(id, status, feedback, adminId, action);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post(':id/view')
  @ApiOperation({
    summary:
      'Record a verified read view after top-to-bottom 2x-speed reading completion (guests & logged-in users)',
  })
  async recordView(
    @Param('id') id: string,
    @Body() dto: RecordPostViewDto,
    @Headers('x-share-token') shareTokenHeader?: string,
    @Headers('x-private-unlock-token') unlockTokenHeader?: string,
    @CurrentUser() currentUser?: any,
    @Req() req?: any,
  ) {
    return this.postsService.recordView(
      id,
      this.buildViewerContext(currentUser, shareTokenHeader, unlockTokenHeader, req),
      dto,
    );
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post(':id/unlock')
  @ApiOperation({
    summary:
      'Unlock a private blog with PIN/password or consume a one-time view and receive full post + unlockToken',
  })
  async unlockPrivatePost(
    @Param('id') id: string,
    @Body() dto: VerifyPrivatePasswordDto,
    @Headers('x-share-token') shareTokenHeader?: string,
    @CurrentUser() currentUser?: any,
    @Req() req?: any,
  ) {
    return this.privatePostsService.unlockPost(
      id,
      this.buildViewerContext(currentUser, dto.shareToken || shareTokenHeader, undefined, req),
      dto,
      { throwOnInvalidPassword: true },
    );
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post(':id/verify-password')
  @ApiOperation({
    summary:
      'Verify password/PIN for private story access (returns { success, unlocked, unlockToken, oneTimeView, post })',
  })
  async verifyPassword(
    @Param('id') id: string,
    @Body() dto: VerifyPrivatePasswordDto,
    @Headers('x-share-token') shareTokenHeader?: string,
    @CurrentUser() currentUser?: any,
    @Req() req?: any,
  ) {
    return this.privatePostsService.unlockPost(
      id,
      this.buildViewerContext(currentUser, dto.shareToken || shareTokenHeader, undefined, req),
      dto,
      { throwOnInvalidPassword: false },
    );
  }

  @Post(':id/report')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a report for an article / blog story' })
  async reportPost(
    @Param('id') postId: string,
    @CurrentUser('id') reporterId: string,
    @Body() body: { reason: string; customNote?: string },
  ) {
    return this.reportsService.createPostReport(
      postId,
      reporterId,
      body?.reason || 'OTHER',
      body?.customNote,
    );
  }
}
