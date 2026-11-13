import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import crypto from 'crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { Role, CollabMode, CollabSuggestionStatus, NotificationType } from '@prisma/client';
import {
  InviteCollabDto,
  UpdateCollabPermissionDto,
  CreateSuggestionDto,
  ReviewSuggestionDto,
  BroadcastCollabEventDto,
} from './dto/collab.dto';
import { PusherService } from './pusher.service';
import { PostEncryptionService } from '../posts/post-encryption.service';

@Injectable()
export class CollabService {
  constructor(
    private prisma: PrismaService,
    private pusherService: PusherService,
    private postEncryptionService: PostEncryptionService,
  ) {}

  generateCollabToken(): string {
    return `collab_${crypto.randomBytes(12).toString('hex')}`;
  }

  async verifyPostAccess(postId: string, userId?: string, userRole?: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        collaborators: {
          include: {
            user: {
              select: { id: true, name: true, username: true, avatar: true, role: true },
            },
          },
        },
      },
    });

    if (!post) {
      throw new NotFoundException(`Story with ID '${postId}' not found.`);
    }

    const isAdmin = String(userRole || '').toUpperCase() === Role.ADMIN;
    const isAuthor = Boolean(userId && post.authorId === userId);
    const collaborator = userId
      ? post.collaborators.find((c) => c.userId === userId)
      : null;
    const isCollaborator = Boolean(collaborator);
    const canEdit = isAuthor || isAdmin || Boolean(collaborator?.canEdit);

    return {
      post,
      isAdmin,
      isAuthor,
      isCollaborator,
      canEdit,
      collaborator,
    };
  }

  async getCollabState(postId: string, userId?: string, userRole?: string) {
    const { post, isAuthor, isAdmin, canEdit } = await this.verifyPostAccess(
      postId,
      userId,
      userRole,
    );

    // If author/admin visits and no collabInviteToken exists yet, generate one
    let inviteToken = post.collabInviteToken;
    if ((isAuthor || isAdmin) && !inviteToken) {
      inviteToken = this.generateCollabToken();
      await this.prisma.post.update({
        where: { id: post.id },
        data: { collabInviteToken: inviteToken },
      });
    }

    const pendingSuggestionsCount = await this.prisma.postSuggestion.count({
      where: {
        postId: post.id,
        status: CollabSuggestionStatus.PENDING,
      },
    });

    const collaborators = post.collaborators.map((c) => ({
      id: c.id,
      userId: c.userId,
      user: c.user,
      canEdit: c.canEdit,
      createdAt: c.createdAt,
    }));

    return {
      postId: post.id,
      title: post.title,
      subtitle: post.subtitle,
      content: this.postEncryptionService.decrypt(post.content, post.id),
      collabMode: post.collabMode || CollabMode.FREE_FLOW,
      collabInviteToken: inviteToken,
      isAuthor: isAuthor || isAdmin,
      canEdit,
      collaborators,
      pendingSuggestionsCount,
    };
  }

  async inviteCollaborator(
    postId: string,
    actorId: string,
    userRole: string | undefined,
    dto: InviteCollabDto,
  ) {
    const { post, isAuthor, isAdmin } = await this.verifyPostAccess(
      postId,
      actorId,
      userRole,
    );

    if (!isAuthor && !isAdmin) {
      throw new ForbiddenException('Only the story author or an Admin can invite collaborators.');
    }

    // Handle regenerating invite token
    if (dto.regenerateToken) {
      const newToken = this.generateCollabToken();
      await this.prisma.post.update({
        where: { id: post.id },
        data: { collabInviteToken: newToken },
      });
      return {
        success: true,
        collabInviteToken: newToken,
        message: 'Collaboration link regenerated successfully.',
      };
    }

    // Identify user to invite
    let targetUser: any = null;
    if (dto.userId) {
      targetUser = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    } else if (dto.email) {
      targetUser = await this.prisma.user.findUnique({
        where: { email: dto.email.trim().toLowerCase() },
      });
    } else if (dto.username) {
      targetUser = await this.prisma.user.findUnique({
        where: { username: dto.username.trim().toLowerCase() },
      });
    }

    if (!targetUser) {
      throw new NotFoundException('Collaborator user not found. Please provide a valid username, email, or user ID.');
    }

    if (targetUser.id === post.authorId) {
      throw new BadRequestException('You are already the author of this story.');
    }

    const isReader = String(targetUser.role || '').toUpperCase() === Role.READER;
    let requestedCanEdit = true;
    if (dto.permission) {
      requestedCanEdit = dto.permission.toUpperCase() === 'EDIT';
    } else if (typeof dto.canEdit === 'boolean') {
      requestedCanEdit = dto.canEdit;
    }

    if (isReader && requestedCanEdit) {
      throw new BadRequestException(
        'Members with READER role cannot be granted write/edit access. Only WRITER or ADMIN members can edit stories. You can grant this member View access.',
      );
    }

    const finalCanEdit = isReader ? false : requestedCanEdit;

    const collaborator = await this.prisma.postCollaborator.upsert({
      where: {
        postId_userId: {
          postId: post.id,
          userId: targetUser.id,
        },
      },
      update: {
        canEdit: finalCanEdit,
      },
      create: {
        postId: post.id,
        userId: targetUser.id,
        canEdit: finalCanEdit,
        invitedById: actorId,
      },
      include: {
        user: {
          select: { id: true, name: true, username: true, avatar: true, role: true },
        },
      },
    });

    // Notify collaborator
    const inviter = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });

    try {
      await this.prisma.notification.create({
        data: {
          recipientId: targetUser.id,
          actorId,
          postId: post.id,
          type: NotificationType.PRIVATE_SHARE,
          message: `${inviter?.name || 'Someone'} invited you to ${finalCanEdit ? 'co-author' : 'view'} "${post.title || 'Untitled'}" in real-time.`,
        },
      });
    } catch (_) {}

    return collaborator;
  }

  async updateCollaboratorPermission(
    postId: string,
    actorId: string,
    userRole: string | undefined,
    targetUserId: string,
    dto: UpdateCollabPermissionDto,
  ) {
    const { post, isAuthor, isAdmin } = await this.verifyPostAccess(
      postId,
      actorId,
      userRole,
    );

    if (!isAuthor && !isAdmin) {
      throw new ForbiddenException('Only the story author or an Admin can manage collaborator permissions.');
    }

    const existing = await this.prisma.postCollaborator.findUnique({
      where: {
        postId_userId: {
          postId: post.id,
          userId: targetUserId,
        },
      },
      include: {
        user: {
          select: { id: true, name: true, username: true, role: true, avatar: true },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Collaborator not found for this story.');
    }

    let newCanEdit = true;
    if (dto.permission) {
      newCanEdit = dto.permission.toUpperCase() === 'EDIT';
    } else if (typeof dto.canEdit === 'boolean') {
      newCanEdit = dto.canEdit;
    }

    const isReader = String(existing.user.role || '').toUpperCase() === Role.READER;
    if (isReader && newCanEdit) {
      throw new BadRequestException(
        'Members with READER role cannot be granted write/edit access. Upgrading to WRITER is required.',
      );
    }

    const finalCanEdit = isReader ? false : newCanEdit;

    const updated = await this.prisma.postCollaborator.update({
      where: {
        postId_userId: {
          postId: post.id,
          userId: targetUserId,
        },
      },
      data: {
        canEdit: finalCanEdit,
      },
      include: {
        user: {
          select: { id: true, name: true, username: true, avatar: true, role: true },
        },
      },
    });

    return updated;
  }

  async removeCollaborator(
    postId: string,
    actorId: string,
    userRole: string | undefined,
    targetUserId: string,
  ) {
    const { post, isAuthor, isAdmin } = await this.verifyPostAccess(
      postId,
      actorId,
      userRole,
    );

    if (!isAuthor && !isAdmin && actorId !== targetUserId) {
      throw new ForbiddenException('Only the story author or an Admin can remove collaborators.');
    }

    await this.prisma.postCollaborator.deleteMany({
      where: {
        postId: post.id,
        userId: targetUserId,
      },
    });

    return { success: true, message: 'Collaborator removed successfully.' };
  }

  async regenerateInviteToken(postId: string, actorId: string, userRole?: string) {
    const { post, isAuthor, isAdmin } = await this.verifyPostAccess(
      postId,
      actorId,
      userRole,
    );

    if (!isAuthor && !isAdmin) {
      throw new ForbiddenException('Only the story author or an Admin can manage the collaboration link.');
    }

    const newToken = this.generateCollabToken();
    const updated = await this.prisma.post.update({
      where: { id: post.id },
      data: { collabInviteToken: newToken },
      select: { id: true, collabInviteToken: true },
    });

    return updated;
  }

  async joinByToken(inviteToken: string, userId: string) {
    if (!inviteToken || inviteToken.trim() === '') {
      throw new BadRequestException('Collaboration token is required.');
    }

    const post = await this.prisma.post.findFirst({
      where: { collabInviteToken: inviteToken.trim() },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true } },
      },
    });

    if (!post) {
      throw new NotFoundException('Invalid or expired collaboration invitation link.');
    }

    if (post.authorId !== userId) {
      const joiningUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      });

      const isReader = String(joiningUser?.role || '').toUpperCase() === Role.READER;

      const existingCollab = await this.prisma.postCollaborator.findUnique({
        where: {
          postId_userId: {
            postId: post.id,
            userId,
          },
        },
      });

      // Readers can ONLY have canEdit: false. Writers / Admins get canEdit: true (or keep existing if already configured)
      const allowedCanEdit = isReader ? false : (existingCollab ? existingCollab.canEdit : true);

      await this.prisma.postCollaborator.upsert({
        where: {
          postId_userId: {
            postId: post.id,
            userId,
          },
        },
        update: {
          canEdit: allowedCanEdit,
        },
        create: {
          postId: post.id,
          userId,
          canEdit: allowedCanEdit,
          invitedById: post.authorId,
        },
      });
    }

    return {
      success: true,
      postId: post.id,
      postTitle: post.title,
      author: post.author,
      collabMode: post.collabMode,
      redirectUrl: `/dashboard/posts/${post.id}`,
    };
  }

  async setCollabMode(
    postId: string,
    actorId: string,
    userRole: string | undefined,
    mode: CollabMode,
  ) {
    const { post, isAuthor, isAdmin } = await this.verifyPostAccess(
      postId,
      actorId,
      userRole,
    );

    if (!isAuthor && !isAdmin) {
      throw new ForbiddenException('Only the story author or an Admin can change collaboration mode.');
    }

    const updated = await this.prisma.post.update({
      where: { id: post.id },
      data: { collabMode: mode },
      select: {
        id: true,
        collabMode: true,
        title: true,
      },
    });

    await this.pusherService.trigger(`post-${postId}`, 'mode-change', { mode });

    return updated;
  }

  async listSuggestions(
    postId: string,
    actorId: string,
    userRole: string | undefined,
    status?: CollabSuggestionStatus,
  ) {
    await this.verifyPostAccess(postId, actorId, userRole);

    return this.prisma.postSuggestion.findMany({
      where: {
        postId,
        ...(status ? { status } : {}),
      },
      include: {
        user: {
          select: { id: true, name: true, username: true, avatar: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async submitSuggestion(postId: string, userId: string, dto: CreateSuggestionDto) {
    const { post, canEdit } = await this.verifyPostAccess(postId, userId);

    if (!canEdit) {
      throw new ForbiddenException('You do not have permission to collaborate on this story.');
    }

    const suggestion = await this.prisma.postSuggestion.create({
      data: {
        postId: post.id,
        userId,
        title: dto.title?.trim() || post.title,
        originalContent: dto.originalContent,
        suggestedContent: dto.suggestedContent,
        diffSummary: dto.diffSummary,
        status: CollabSuggestionStatus.PENDING,
      },
      include: {
        user: {
          select: { id: true, name: true, username: true, avatar: true, role: true },
        },
      },
    });

    // Notify the author if the author is not the submitter
    if (post.authorId !== userId) {
      try {
        await this.prisma.notification.create({
          data: {
            recipientId: post.authorId,
            actorId: userId,
            postId: post.id,
            type: NotificationType.EDITORIAL_FLAG,
            message: `${suggestion.user.name} proposed revisions to your draft "${post.title || 'Untitled'}". Review the diff to approve.`,
          },
        });
      } catch (_) {}
    }

    const pendingSuggestionsCount = await this.prisma.postSuggestion.count({
      where: { postId: post.id, status: CollabSuggestionStatus.PENDING },
    });

    await this.pusherService.trigger(`post-${postId}`, 'new-suggestion', {
      suggestion,
      pendingSuggestionsCount,
    });

    return suggestion;
  }

  async reviewSuggestion(
    postId: string,
    suggestionId: string,
    actorId: string,
    userRole: string | undefined,
    dto: ReviewSuggestionDto,
  ) {
    const { post, isAuthor, isAdmin } = await this.verifyPostAccess(
      postId,
      actorId,
      userRole,
    );

    if (!isAuthor && !isAdmin) {
      throw new ForbiddenException('Only the story author or an Admin can review suggestions.');
    }

    const suggestion = await this.prisma.postSuggestion.findUnique({
      where: { id: suggestionId },
      include: {
        user: { select: { id: true, name: true, username: true } },
      },
    });

    if (!suggestion || suggestion.postId !== post.id) {
      throw new NotFoundException('Suggestion not found for this story.');
    }

    if (suggestion.status !== CollabSuggestionStatus.PENDING) {
      throw new BadRequestException(`This suggestion has already been ${suggestion.status.toLowerCase()}.`);
    }

    const reviewer = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });

    if (dto.action === 'APPROVE') {
      const wordCount = suggestion.suggestedContent
        .replace(/<[^>]*>/g, '')
        .split(/\s+/)
        .filter(Boolean).length;
      const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

      const isPrivate = post.visibility === 'PRIVATE';
      const finalContent = isPrivate
        ? this.postEncryptionService.encrypt(suggestion.suggestedContent, post.id)
        : suggestion.suggestedContent;

      // 1. Update post with merged content
      await this.prisma.post.update({
        where: { id: post.id },
        data: {
          content: finalContent,
          title: suggestion.title || post.title,
          wordCount,
          readingTimeMinutes,
        },
      });

      // 2. Record version snapshot
      await this.prisma.postVersion.create({
        data: {
          postId: post.id,
          title: suggestion.title || post.title,
          content: suggestion.suggestedContent,
          authorName: `${reviewer?.name || 'Author'} (Approved change from ${suggestion.user.name})`,
          savedAt: new Date(),
        },
      });

      // 3. Mark suggestion as approved
      const updatedSuggestion = await this.prisma.postSuggestion.update({
        where: { id: suggestionId },
        data: {
          status: CollabSuggestionStatus.APPROVED,
          reviewNote: dto.reviewNote,
          reviewedAt: new Date(),
          reviewedById: actorId,
        },
        include: {
          user: { select: { id: true, name: true, username: true, avatar: true } },
        },
      });

      // 4. Notify suggestion submitter
      try {
        await this.prisma.notification.create({
          data: {
            recipientId: suggestion.userId,
            actorId,
            postId: post.id,
            type: NotificationType.EDITORIAL_FLAG,
            message: `${reviewer?.name || 'Author'} approved and merged your proposed changes to "${post.title || 'Untitled'}".`,
          },
        });
      } catch (_) {}

      const pendingCount = await this.prisma.postSuggestion.count({
        where: { postId: post.id, status: CollabSuggestionStatus.PENDING },
      });

      await this.pusherService.trigger(`post-${postId}`, 'suggestion-reviewed', {
        suggestionId,
        action: 'APPROVE',
        reviewNote: dto.reviewNote,
        reviewedBy: reviewer?.name,
        pendingSuggestionsCount: pendingCount,
        mergedContent: suggestion.suggestedContent,
      });

      return {
        suggestion: updatedSuggestion,
        mergedContent: suggestion.suggestedContent,
        action: 'APPROVED',
      };
    } else {
      // REJECT
      const updatedSuggestion = await this.prisma.postSuggestion.update({
        where: { id: suggestionId },
        data: {
          status: CollabSuggestionStatus.REJECTED,
          reviewNote: dto.reviewNote,
          reviewedAt: new Date(),
          reviewedById: actorId,
        },
        include: {
          user: { select: { id: true, name: true, username: true, avatar: true } },
        },
      });

      try {
        await this.prisma.notification.create({
          data: {
            recipientId: suggestion.userId,
            actorId,
            postId: post.id,
            type: NotificationType.EDITORIAL_FLAG,
            message: `${reviewer?.name || 'Author'} declined your suggestion for "${post.title || 'Untitled'}": ${dto.reviewNote || 'No feedback provided.'}`,
          },
        });
      } catch (_) {}

      const pendingCount = await this.prisma.postSuggestion.count({
        where: { postId: post.id, status: CollabSuggestionStatus.PENDING },
      });

      await this.pusherService.trigger(`post-${postId}`, 'suggestion-reviewed', {
        suggestionId,
        action: 'REJECT',
        reviewNote: dto.reviewNote,
        reviewedBy: reviewer?.name,
        pendingSuggestionsCount: pendingCount,
      });

      return {
        suggestion: updatedSuggestion,
        action: 'REJECTED',
      };
    }
  }

  async broadcastEvent(
    postId: string,
    userId: string,
    userRole: string | undefined,
    dto: BroadcastCollabEventDto,
  ) {
    const { canEdit } = await this.verifyPostAccess(postId, userId, userRole);
    if (!canEdit) {
      throw new ForbiddenException('You do not have write access to this story.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, avatar: true },
    });

    const eventName = dto.event;
    const rawData = dto.data || {};

    let payload: any = {
      ...rawData,
      userId,
      userName: user?.name || 'Collaborator',
      timestamp: new Date().toISOString(),
    };

    // Free Tier Guard: Pusher message payload limit is 10 KB.
    // If payload stringified length > 8192 bytes, emit sync_required notification instead of full payload.
    const jsonStr = JSON.stringify(payload);
    if (jsonStr.length > 8192) {
      payload = {
        type: 'sync_required',
        userId,
        userName: user?.name || 'Collaborator',
        timestamp: new Date().toISOString(),
      };
    }

    const channel = `post-${postId}`;
    await this.pusherService.trigger(channel, eventName, payload);

    return { success: true };
  }
}
