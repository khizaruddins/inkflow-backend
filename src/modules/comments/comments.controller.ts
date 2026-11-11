import { Controller, Get, Post, Body, Param, Query, Headers, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ReportCommentDto } from './dto/report-comment.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

@ApiTags('Comments')
@Controller('comments')
export class CommentsController {
  constructor(private commentsService: CommentsService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  @ApiOperation({ summary: 'Get responses and nested reply tree for a post' })
  async findByPostId(
    @Query('postId') postId: string,
    @Query('shareToken') shareTokenQuery?: string,
    @Query('unlockToken') unlockTokenQuery?: string,
    @Headers('x-share-token') shareTokenHeader?: string,
    @Headers('x-private-unlock-token') unlockTokenHeader?: string,
    @CurrentUser() currentUser?: any,
  ) {
    return this.commentsService.findByPostId(postId, currentUser, {
      shareToken: shareTokenHeader || shareTokenQuery,
      unlockToken: unlockTokenHeader || unlockTokenQuery,
    });
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Post a response or nested reply (Authenticated readers only)' })
  async create(
    @CurrentUser() currentUser: any,
    @Body() dto: CreateCommentDto,
    @Headers('x-private-unlock-token') unlockToken?: string,
  ) {
    return this.commentsService.create(currentUser.id, dto, currentUser, unlockToken);
  }

  @Post(':id/report')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Report a response for admin moderation evaluation' })
  async report(
    @Param('id') commentId: string,
    @CurrentUser('id') reporterId: string,
    @Body() dto: ReportCommentDto,
  ) {
    return this.commentsService.report(commentId, reporterId, dto);
  }
}
