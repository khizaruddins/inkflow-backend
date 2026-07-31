import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ReportCommentDto } from './dto/report-comment.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Comments')
@Controller('comments')
export class CommentsController {
  constructor(private commentsService: CommentsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get responses and nested reply tree for a post' })
  async findByPostId(@Query('postId') postId: string) {
    return this.commentsService.findByPostId(postId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Post a response or nested reply (Authenticated readers only)' })
  async create(@CurrentUser('id') authorId: string, @Body() dto: CreateCommentDto) {
    return this.commentsService.create(authorId, dto);
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
