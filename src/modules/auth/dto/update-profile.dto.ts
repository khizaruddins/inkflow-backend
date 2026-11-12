import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Syed Khizaruddin', description: 'Display name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'syed_khizar', description: 'Unique handle / username' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  username?: string;

  @ApiPropertyOptional({
    example: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb',
    description: 'Avatar image URL',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  avatar?: string;

  @ApiPropertyOptional({
    example: 'Senior Systems Engineer & Technical Writer',
    description: 'Author bio',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;
}
