import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({ example: '60d5ec49f1b2c80015f8a001', description: 'Post ObjectId' })
  @IsString()
  @IsNotEmpty()
  postId: string;

  @ApiProperty({ example: 'Sensational article! <strong>Great job</strong>', description: 'HTML formatted response content' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ example: '60d5ec49f1b2c80015f8a002', required: false, description: 'Parent Comment ObjectId for nested replies' })
  @IsOptional()
  @IsString()
  parentId?: string;
}
