import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsArray, IsEnum, IsBoolean } from 'class-validator';
import { PostVisibility, PrivateLockType } from '@prisma/client';

export class SaveDraftDto {
  @ApiProperty({ required: false, description: 'Post ID if updating an existing draft' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ required: false, example: 'Untitled' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ required: false, example: 'Untitled Subtitle' })
  @IsOptional()
  @IsString()
  subtitle?: string;

  @ApiProperty({ required: false, example: '<p>Draft content</p>' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  coverImage?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  tagIds?: string[];

  @ApiProperty({ required: false, enum: PostVisibility })
  @IsOptional()
  @IsEnum(PostVisibility)
  visibility?: PostVisibility;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  secretPassword?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiProperty({ required: false, enum: PrivateLockType })
  @IsOptional()
  @IsEnum(PrivateLockType)
  privateLockType?: PrivateLockType;

  @ApiProperty({ required: false, enum: PrivateLockType })
  @IsOptional()
  @IsEnum(PrivateLockType)
  lockType?: PrivateLockType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  allowLinkPasswordAccess?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  requirePasswordForGrantedUsers?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  requireFollowerToView?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  removePassword?: boolean;
}
