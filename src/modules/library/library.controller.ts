import { Controller, Get, Post, Delete, Body, Param, Headers, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LibraryService } from './library.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Library')
@Controller('library')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LibraryController {
  constructor(private libraryService: LibraryService) {}

  @Get('lists')
  @ApiOperation({ summary: 'Get user custom reading lists' })
  async getReadingLists(@CurrentUser('id') userId: string) {
    return this.libraryService.getReadingLists(userId);
  }

  @Post('lists')
  @ApiOperation({ summary: 'Create a new custom reading list' })
  async createReadingList(
    @CurrentUser('id') userId: string,
    @Body('name') name: string,
    @Body('description') description?: string,
    @Body('isPrivate') isPrivate?: boolean,
  ) {
    return this.libraryService.createReadingList(userId, name, description, isPrivate);
  }

  @Get('bookmarks')
  @ApiOperation({ summary: 'Get saved bookmarked articles' })
  async getBookmarks(@CurrentUser() user: any) {
    return this.libraryService.getBookmarks(user.id, user.role);
  }

  @Post('bookmarks/toggle')
  @ApiOperation({ summary: 'Toggle article bookmark' })
  async toggleBookmark(
    @CurrentUser() user: any,
    @Body('postId') postId: string,
    @Headers('x-private-unlock-token') unlockToken?: string,
  ) {
    return this.libraryService.toggleBookmark(user.id, postId, user, unlockToken);
  }

  @Get('highlights')
  @ApiOperation({ summary: 'Fetch user text selection quote highlights' })
  async getHighlights(@CurrentUser() user: any) {
    return this.libraryService.getHighlights(user.id, user.role);
  }

  @Post('highlights')
  @ApiOperation({ summary: 'Save a text selection quote highlight' })
  async createHighlight(
    @CurrentUser() user: any,
    @Body('postId') postId: string,
    @Body('text') text: string,
    @Body('title') title?: string,
    @Body('note') note?: string,
    @Headers('x-private-unlock-token') unlockToken?: string,
  ) {
    return this.libraryService.createHighlight(user.id, postId, text, title, note, user, unlockToken);
  }

  @Delete('highlights/:id')
  @ApiOperation({ summary: 'Delete a saved quote highlight' })
  async deleteHighlight(@Param('id') id: string) {
    return this.libraryService.deleteHighlight(id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get recent reading history' })
  async getHistory(@CurrentUser() user: any) {
    return this.libraryService.getHistory(user.id, user.role);
  }

  @Post('history')
  @ApiOperation({ summary: 'Record story view to user reading history' })
  async recordHistory(
    @CurrentUser() user: any,
    @Body('postId') postId: string,
    @Headers('x-private-unlock-token') unlockToken?: string,
  ) {
    const userId = user?.id || user?.sub;
    const role = user?.role;
    return this.libraryService.recordHistory(userId, postId, role, user, unlockToken);
  }
}
