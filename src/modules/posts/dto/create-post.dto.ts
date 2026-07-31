import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsEnum, IsBoolean, IsArray } from 'class-validator';
import { PostStatus, PostVisibility } from '@prisma/client';

export class CreatePostDto {
  @ApiProperty({ example: 'Building Next-Generation React 19 Frontend Architectures' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'A deep dive into Server Components and TipTap integration', required: false })
  @IsOptional()
  @IsString()
  subtitle?: string;

  @ApiProperty({ example: 'building-next-generation-react-19-frontend-architectures' })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiProperty({ example: 'Explore how React 19 Server Components combined with Next.js 16...' })
  @IsString()
  @IsNotEmpty()
  excerpt: string;

  @ApiProperty({ example: '<h2>The Evolution of Modern Web Applications</h2><p>Content body...</p>' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ example: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe' })
  @IsString()
  @IsNotEmpty()
  coverImage: string;

  @ApiProperty({ example: '60d5ec49f1b2c80015f8a001', description: 'Category ObjectId' })
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({ example: ['60d5ec49f1b2c80015f8a002'], required: false })
  @IsOptional()
  @IsArray()
  tagIds?: string[];

  @ApiProperty({ example: 'PUBLISHED', enum: PostStatus, required: false })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;

  @ApiProperty({ example: 'PUBLIC', enum: PostVisibility, required: false })
  @IsOptional()
  @IsEnum(PostVisibility)
  visibility?: PostVisibility;

  @ApiProperty({ example: 'secret123', required: false, description: 'Secret password for private posts' })
  @IsOptional()
  @IsString()
  secretPassword?: string;
}
