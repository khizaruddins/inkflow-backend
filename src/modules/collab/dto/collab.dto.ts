import { IsString, IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CollabMode } from '@prisma/client';

export class InviteCollabDto {
  @ApiPropertyOptional({ description: 'User ID to invite' })
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({ description: 'User email to invite' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'User username to invite' })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional({ description: 'Whether the collaborator can edit directly', default: true })
  @IsBoolean()
  @IsOptional()
  canEdit?: boolean;

  @ApiPropertyOptional({ enum: ['VIEW', 'EDIT'], description: 'Collaboration permission: VIEW or EDIT', default: 'EDIT' })
  @IsString()
  @IsOptional()
  permission?: 'VIEW' | 'EDIT';

  @ApiPropertyOptional({ description: 'Regenerate public collaboration link' })
  @IsBoolean()
  @IsOptional()
  regenerateToken?: boolean;
}

export class UpdateCollabPermissionDto {
  @ApiPropertyOptional({ description: 'Whether the collaborator can edit directly' })
  @IsBoolean()
  @IsOptional()
  canEdit?: boolean;

  @ApiPropertyOptional({ enum: ['VIEW', 'EDIT'], description: 'Collaboration permission: VIEW or EDIT' })
  @IsString()
  @IsOptional()
  permission?: 'VIEW' | 'EDIT';
}

export class SetCollabModeDto {
  @ApiProperty({ enum: CollabMode, description: 'Collaboration mode: FREE_FLOW or APPROVAL_REQUIRED' })
  @IsEnum(CollabMode)
  mode: CollabMode;
}

export class CreateSuggestionDto {
  @ApiPropertyOptional({ description: 'Optional title of the proposed story revision' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ description: 'Original HTML content before changes' })
  @IsString()
  originalContent: string;

  @ApiProperty({ description: 'Proposed HTML content with suggested changes' })
  @IsString()
  suggestedContent: string;

  @ApiPropertyOptional({ description: 'Short summary or diff overview of proposed changes' })
  @IsString()
  @IsOptional()
  diffSummary?: string;
}

export class ReviewSuggestionDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'], description: 'Review action: APPROVE or REJECT' })
  @IsString()
  action: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional({ description: 'Feedback or rationale for approval or rejection' })
  @IsString()
  @IsOptional()
  reviewNote?: string;
}

export class BroadcastCollabEventDto {
  @ApiProperty({ description: 'Event name (e.g. content-change, user-typing)' })
  @IsString()
  event: string;

  @ApiPropertyOptional({ description: 'Event payload data' })
  @IsOptional()
  data?: any;
}

