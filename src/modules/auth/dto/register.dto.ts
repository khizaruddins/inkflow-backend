import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength, IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class RegisterDto {
  @ApiProperty({ example: 'syed@inkflow.dev', description: 'User email address' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'Syed Khizaruddin', description: 'Full name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'syed_khizar', description: 'Unique handle / username' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: 'Password123!', description: 'Minimum 6 character password' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'READER', enum: Role, required: false })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
