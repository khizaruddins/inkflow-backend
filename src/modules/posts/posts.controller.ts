import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Posts')
@Controller('posts')
export class PostsController {
  constructor(private postsService: PostsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get published articles feed with search & status filters' })
  async findAll(
    @Query('status') status?: string,
    @Query('categoryId') categoryId?: string,
    @Query('authorId') authorId?: string,
    @Query('search') search?: string,
  ) {
    return this.postsService.findAll({ status, categoryId, authorId, search });
  }

  @Public()
  @Get(':slugOrId')
  @ApiOperation({ summary: 'Fetch single story details by slug or ObjectId' })
  async findOne(@Param('slugOrId') slugOrId: string) {
    return this.postsService.findBySlugOrId(slugOrId);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.WRITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create & publish a new blog post (Writer / Admin only)' })
  async create(@CurrentUser('id') authorId: string, @Body() dto: CreatePostDto) {
    return this.postsService.create(authorId, dto);
  }

  @Post(':id/clap')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clap for a story (Authenticated readers only)' })
  async clap(@Param('id') id: string) {
    return this.postsService.clap(id);
  }

  @Public()
  @Post(':id/verify-password')
  @ApiOperation({ summary: 'Verify password for encrypted private story access' })
  async verifyPassword(@Param('id') id: string, @Body('password') password: string) {
    const isValid = await this.postsService.verifySecretPassword(id, password);
    return { success: isValid };
  }
}
