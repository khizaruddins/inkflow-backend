import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Programming', description: 'Category / Topic name' })
  @IsString()
  @IsNotEmpty()
  name: string;
}
