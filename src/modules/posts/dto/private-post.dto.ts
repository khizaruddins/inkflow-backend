import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, IsEnum } from 'class-validator';
import { PostVisibility, PrivateAccessStatus, PrivateLockType } from '@prisma/client';

export class UpdatePrivateSettingsDto {
  @ApiProperty({ enum: PostVisibility, required: false })
  @IsOptional()
  @IsEnum(PostVisibility)
  visibility?: PostVisibility;

  @ApiProperty({ required: false, description: 'New PIN or password for this private blog' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiProperty({ required: false, description: 'Alias for password' })
  @IsOptional()
  @IsString()
  secretPassword?: string;

  @ApiProperty({ enum: PrivateLockType, required: false, description: 'NONE | PIN | PASSWORD' })
  @IsOptional()
  @IsEnum(PrivateLockType)
  lockType?: PrivateLockType;

  @ApiProperty({ enum: PrivateLockType, required: false, description: 'Alias for lockType' })
  @IsOptional()
  @IsEnum(PrivateLockType)
  privateLockType?: PrivateLockType;

  @ApiProperty({ required: false, description: 'Set true to remove blog-level password/PIN' })
  @IsOptional()
  @IsBoolean()
  removePassword?: boolean;

  @ApiProperty({ required: false, description: 'Allow share link + password/PIN access for uninvited visitors' })
  @IsOptional()
  @IsBoolean()
  allowLinkPasswordAccess?: boolean;

  @ApiProperty({ required: false, description: 'Require blog password/PIN even for explicitly shared users' })
  @IsOptional()
  @IsBoolean()
  requirePasswordForGrantedUsers?: boolean;

  @ApiProperty({ required: false, description: 'Require readers to follow the author before viewing' })
  @IsOptional()
  @IsBoolean()
  requireFollowerToView?: boolean;

  @ApiProperty({ required: false, description: 'Regenerate shareToken to invalidate previous share URLs' })
  @IsOptional()
  @IsBoolean()
  regenerateShareToken?: boolean;
}

export class GrantPrivateAccessDto {
  @ApiProperty({ required: false, description: 'Target reader ObjectId to grant access' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ required: false, description: 'Target reader username or email (alternative to userId)' })
  @IsOptional()
  @IsString()
  usernameOrEmail?: string;

  @ApiProperty({ required: false, default: false, description: 'Allow only a single view for this reader' })
  @IsOptional()
  @IsBoolean()
  oneTimeView?: boolean;

  @ApiProperty({ required: false, description: 'Optional per-user PIN or password required for this reader' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiProperty({ enum: PrivateLockType, required: false })
  @IsOptional()
  @IsEnum(PrivateLockType)
  lockType?: PrivateLockType;

  @ApiProperty({ required: false, description: 'Override whether this user needs to enter blog password if no per-user password is set' })
  @IsOptional()
  @IsBoolean()
  requirePassword?: boolean;
}

export class UpdatePrivateAccessDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  oneTimeView?: boolean;

  @ApiProperty({ required: false, description: 'Set or update per-user PIN/password' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiProperty({ enum: PrivateLockType, required: false })
  @IsOptional()
  @IsEnum(PrivateLockType)
  lockType?: PrivateLockType;

  @ApiProperty({ required: false, description: 'Remove per-user PIN/password' })
  @IsOptional()
  @IsBoolean()
  removePassword?: boolean;

  @ApiProperty({ required: false, description: 'Override whether this user needs to enter blog password' })
  @IsOptional()
  @IsBoolean()
  requirePassword?: boolean;

  @ApiProperty({ required: false, description: 'Reset consumed one-time view back to ACTIVE' })
  @IsOptional()
  @IsBoolean()
  resetView?: boolean;

  @ApiProperty({ enum: PrivateAccessStatus, required: false, description: 'Restore or revoke access status' })
  @IsOptional()
  @IsEnum(PrivateAccessStatus)
  status?: PrivateAccessStatus;
}

export class VerifyPrivatePasswordDto {
  @ApiProperty({ required: false, description: 'PIN or password to unlock the private blog' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiProperty({ required: false, description: 'PIN alias for password' })
  @IsOptional()
  @IsString()
  pin?: string;

  @ApiProperty({ required: false, description: 'Optional shareToken from share URL' })
  @IsOptional()
  @IsString()
  shareToken?: string;
}
