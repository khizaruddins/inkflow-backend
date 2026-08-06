import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsArray } from 'class-validator';

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
}
