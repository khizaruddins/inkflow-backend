import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface UnsplashPhotoDto {
  id: string;
  title: string;
  url: string;
  thumbUrl?: string;
  downloadUrl?: string;
  photographer: string;
  photographerUsername?: string;
  photographerUrl?: string;
  width?: number;
  height?: number;
  color?: string;
}

@Injectable()
export class UnsplashService {
  private readonly logger = new Logger(UnsplashService.name);
  private readonly unsplashApiBase = 'https://api.unsplash.com';

  constructor(private readonly configService: ConfigService) {}

  private getAccessKey(): string {
    const key = this.configService.get<string>('UNSPLASH_ACCESS_KEY');
    if (!key) {
      this.logger.warn('UNSPLASH_ACCESS_KEY is not defined in environment variables');
    }
    return key || '';
  }

  async searchPhotos(query: string, page = 1, perPage = 24): Promise<{
    total: number;
    totalPages: number;
    results: UnsplashPhotoDto[];
  }> {
    const accessKey = this.getAccessKey();
    const cleanQuery = (query || '').trim();

    if (!cleanQuery) {
      return { total: 0, totalPages: 0, results: [] };
    }

    if (!accessKey) {
      return { total: 0, totalPages: 0, results: [] };
    }

    try {
      const url = new URL(`${this.unsplashApiBase}/search/photos`);
      url.searchParams.append('query', cleanQuery);
      url.searchParams.append('page', String(page));
      url.searchParams.append('per_page', String(perPage));
      url.searchParams.append('client_id', accessKey);

      const response = await fetch(url.toString(), {
        headers: {
          'Accept-Version': 'v1',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Unsplash API search error: ${response.status} - ${errorText}`);
        throw new HttpException(
          `Unsplash API search failed with status ${response.status}`,
          response.status,
        );
      }

      const data = await response.json();
      const results: UnsplashPhotoDto[] = (data.results || []).map((p: any) => ({
        id: p.id,
        title: p.description || p.alt_description || `${cleanQuery} photo`,
        url: p.urls?.regular || p.urls?.small,
        thumbUrl: p.urls?.thumb || p.urls?.small,
        downloadUrl: p.links?.download_location,
        photographer: p.user?.name || 'Unsplash Contributor',
        photographerUsername: p.user?.username,
        photographerUrl: p.user?.links?.html || 'https://unsplash.com',
        width: p.width,
        height: p.height,
        color: p.color,
      }));

      return {
        total: data.total || results.length,
        totalPages: data.total_pages || 1,
        results,
      };
    } catch (err: any) {
      this.logger.error(`Failed to fetch photos from Unsplash: ${err.message}`);
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        'Failed to connect to Unsplash API',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getRandomPhotos(query?: string, count = 10): Promise<UnsplashPhotoDto[]> {
    const accessKey = this.getAccessKey();
    if (!accessKey) return [];

    try {
      const url = new URL(`${this.unsplashApiBase}/photos/random`);
      if (query && query.trim()) {
        url.searchParams.append('query', query.trim());
      }
      url.searchParams.append('count', String(Math.min(count, 30)));
      url.searchParams.append('client_id', accessKey);

      const response = await fetch(url.toString(), {
        headers: { 'Accept-Version': 'v1' },
      });

      if (!response.ok) {
        throw new HttpException('Failed to fetch random photos', response.status);
      }

      const data = await response.json();
      const rawList = Array.isArray(data) ? data : [data];

      return rawList.map((p: any) => ({
        id: p.id,
        title: p.description || p.alt_description || 'Unsplash photo',
        url: p.urls?.regular || p.urls?.small,
        thumbUrl: p.urls?.thumb || p.urls?.small,
        downloadUrl: p.links?.download_location,
        photographer: p.user?.name || 'Unsplash Contributor',
        photographerUsername: p.user?.username,
        photographerUrl: p.user?.links?.html || 'https://unsplash.com',
        width: p.width,
        height: p.height,
        color: p.color,
      }));
    } catch (err: any) {
      this.logger.error(`Failed to fetch random photos from Unsplash: ${err.message}`);
      return [];
    }
  }
}
