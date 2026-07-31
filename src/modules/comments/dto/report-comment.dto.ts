import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional } from 'class-validator';

export class ReportCommentDto {
  @ApiProperty({ example: ['Harassment', 'Spam'], description: 'Violation categories' })
  @IsArray()
  @IsNotEmpty()
  reasons: string[];

  @ApiProperty({ example: false, required: false, description: 'Optionally block comment author' })
  @IsOptional()
  @IsBoolean()
  blockAuthor?: boolean;
}
