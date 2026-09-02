import { Controller, Get, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { UnsplashService } from './unsplash.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Unsplash')
@Controller('unsplash')
export class UnsplashController {
  constructor(private readonly unsplashService: UnsplashService) {}

  @Public()
  @Get('search')
  @ApiOperation({ summary: 'Search high-resolution royalty-free photos from Unsplash API' })
  @ApiQuery({ name: 'query', required: true, description: 'Search term or keyword' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'perPage', required: false, description: 'Items per page (default: 24)' })
  async search(
    @Query('query') query: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('perPage', new DefaultValuePipe(24), ParseIntPipe) perPage: number,
  ) {
    return this.unsplashService.searchPhotos(query, page, perPage);
  }

  @Public()
  @Get('random')
  @ApiOperation({ summary: 'Get random high-resolution royalty-free photos from Unsplash API' })
  @ApiQuery({ name: 'query', required: false, description: 'Optional topic/keyword filter' })
  @ApiQuery({ name: 'count', required: false, description: 'Number of photos to return (default: 10)' })
  async random(
    @Query('query') query?: string,
    @Query('count', new DefaultValuePipe(10), ParseIntPipe) count?: number,
  ) {
    return this.unsplashService.getRandomPhotos(query, count);
  }
}
