import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsEnum, IsBoolean, IsArray } from 'class-validator';
import { PostStatus, PostVisibility, PrivateLockType } from '@prisma/client';

export class CreatePostDto {
  @ApiProperty({ example: '6ab3a11eb05a5f9f06ac41ff', required: false, description: 'Post ID if updating an existing post or draft' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Building Next-Generation React 19 Frontend Architectures' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'A deep dive into Server Components and TipTap integration', required: false })
  @IsOptional()
  @IsString()
  subtitle?: string;

  @ApiProperty({ example: 'building-next-generation-react-19-frontend-architectures', required: false })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiProperty({ example: 'Explore how React 19 Server Components combined with Next.js 16...' })
  @IsString()
  @IsNotEmpty()
  excerpt: string;

  @ApiProperty({ example: '<h2>The Evolution of Modern Web Applications</h2><p>Content body...</p>' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ example: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe', required: false })
  @IsOptional()
  @IsString()
  coverImage?: string;

  @ApiProperty({ example: '60d5ec49f1b2c80015f8a001', required: false, description: 'Category ObjectId' })
  @IsOptional()
  @IsString()
  categoryId?: string;

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

  @ApiProperty({ required: false, description: 'Optional boolean alias for visibility === PRIVATE' })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @ApiProperty({ example: 'secret123', required: false, description: 'Secret password or PIN for private posts' })
  @IsOptional()
  @IsString()
  secretPassword?: string;

  @ApiProperty({ required: false, description: 'Alias for secretPassword' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiProperty({ example: 'PIN', enum: PrivateLockType, required: false, description: 'Lock input type (NONE | PIN | PASSWORD)' })
  @IsOptional()
  @IsEnum(PrivateLockType)
  privateLockType?: PrivateLockType;

  @ApiProperty({ enum: PrivateLockType, required: false, description: 'Alias for privateLockType' })
  @IsOptional()
  @IsEnum(PrivateLockType)
  lockType?: PrivateLockType;

  @ApiProperty({ example: true, required: false, description: 'Allow anyone with share link + password/PIN to unlock' })
  @IsOptional()
  @IsBoolean()
  allowLinkPasswordAccess?: boolean;

  @ApiProperty({ example: false, required: false, description: 'Also require blog password for explicitly granted users' })
  @IsOptional()
  @IsBoolean()
  requirePasswordForGrantedUsers?: boolean;

  @ApiProperty({ example: false, required: false, description: 'Require readers to follow the author before viewing' })
  @IsOptional()
  @IsBoolean()
  requireFollowerToView?: boolean;

  @ApiProperty({ example: false, required: false, description: 'Remove existing blog password when updating' })
  @IsOptional()
  @IsBoolean()
  removePassword?: boolean;
}
