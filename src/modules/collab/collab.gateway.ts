import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/database/prisma.service';
import { CollabService } from './collab.service';
import { PostEncryptionService } from '../posts/post-encryption.service';
import { CollabMode, Role } from '@prisma/client';

export interface CollabUser {
  socketId: string;
  userId: string;
  name: string;
  username: string;
  avatar: string;
  role: string;
  color: string;
  isAuthor: boolean;
  canEdit: boolean;
}

const PRESENCE_COLORS = [
  '#10B981', // emerald
  '#3B82F6', // blue
  '#8B5CF6', // purple
  '#F59E0B', // amber
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#E11D48', // rose
  '#14B8A6', // teal
];

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class CollabGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('CollabGateway');

  // Map of postId -> (socketId -> CollabUser)
  private roomUsers = new Map<string, Map<string, CollabUser>>();

  // Debounced auto-save timers per post
  private saveDebounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private prisma: PrismaService,
    private collabService: CollabService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private postEncryptionService: PostEncryptionService,
  ) {}

  private extractToken(client: Socket): string | null {
    const authHeader =
      client.handshake.auth?.token ||
      client.handshake.headers?.authorization ||
      client.handshake.query?.token;

    if (!authHeader) return null;
    return String(authHeader).replace(/^Bearer\s+/i, '').trim();
  }

  private async authenticateSocket(client: Socket): Promise<{
    id: string;
    name: string;
    username: string;
    avatar: string;
    role: string;
  } | null> {
    try {
      const token = this.extractToken(client);
      if (!token) return null;

      const secret =
        this.configService.get<string>('JWT_ACCESS_SECRET') ||
        'inkflow_jwt_access_super_secret_key_2026';

      const payload = this.jwtService.verify(token, { secret });
      if (!payload?.sub) return null;

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          name: true,
          username: true,
          avatar: true,
          role: true,
        },
      });

      return user || null;
    } catch (_) {
      return null;
    }
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Socket connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Socket disconnected: ${client.id}`);
    this.removeUserFromAllRooms(client.id);
  }

  private removeUserFromAllRooms(socketId: string) {
    for (const [postId, users] of this.roomUsers.entries()) {
      if (users.has(socketId)) {
        const removedUser = users.get(socketId);
        users.delete(socketId);

        const activeUsers = Array.from(users.values());
        this.server.to(postId).emit('presence-update', {
          postId,
          activeUsers,
          leftUser: removedUser,
        });

        if (users.size === 0) {
          this.roomUsers.delete(postId);
        }
      }
    }
  }

  @SubscribeMessage('join-room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      postId: string;
      token?: string;
      inviteToken?: string;
    },
  ) {
    if (!data?.postId) {
      return client.emit('error', { message: 'postId is required' });
    }

    const user = await this.authenticateSocket(client);
    if (!user) {
      return client.emit('error', { message: 'Authentication required for real-time collaboration' });
    }

    try {
      // If inviteToken is present, auto-join as collaborator if needed
      if (data.inviteToken) {
        try {
          await this.collabService.joinByToken(data.inviteToken, user.id);
        } catch (_) {}
      }

      const access = await this.collabService.verifyPostAccess(
        data.postId,
        user.id,
        user.role,
      );

      if (!access.canEdit && !access.isAuthor && !access.isAdmin && !access.isCollaborator) {
        return client.emit('error', { message: 'You do not have access to this story room' });
      }

      await client.join(data.postId);

      if (!this.roomUsers.has(data.postId)) {
        this.roomUsers.set(data.postId, new Map());
      }
      const postRoomUsers = this.roomUsers.get(data.postId)!;

      // Assign deterministic color based on room position
      const colorIndex = postRoomUsers.size % PRESENCE_COLORS.length;
      const assignedColor = PRESENCE_COLORS[colorIndex];

      const collabUser: CollabUser = {
        socketId: client.id,
        userId: user.id,
        name: user.name,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
        color: assignedColor,
        isAuthor: access.isAuthor || access.isAdmin,
        canEdit: access.canEdit,
      };

      postRoomUsers.set(client.id, collabUser);
      const activeUsers = Array.from(postRoomUsers.values());

      const pendingSuggestionsCount = await this.prisma.postSuggestion.count({
        where: {
          postId: data.postId,
          status: 'PENDING',
        },
      });

      // Acknowledge to joined client
      client.emit('room-joined', {
        postId: data.postId,
        collabMode: access.post.collabMode || CollabMode.FREE_FLOW,
        isAuthor: access.isAuthor || access.isAdmin,
        canEdit: access.canEdit,
        activeUsers,
        currentUser: collabUser,
        post: {
          title: access.post.title,
          subtitle: access.post.subtitle,
          content: this.postEncryptionService.decrypt(access.post.content, access.post.id),
        },
        pendingSuggestionsCount,
      });

      // Broadcast updated presence to all clients in this story room
      this.server.to(data.postId).emit('presence-update', {
        postId: data.postId,
        activeUsers,
        joinedUser: collabUser,
      });

      this.logger.log(`User ${user.name} joined room ${data.postId}`);
    } catch (err: any) {
      client.emit('error', { message: err?.message || 'Failed to join collaboration room' });
    }
  }

  @SubscribeMessage('leave-room')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { postId: string },
  ) {
    if (!data?.postId) return;

    await client.leave(data.postId);

    const postRoomUsers = this.roomUsers.get(data.postId);
    if (postRoomUsers && postRoomUsers.has(client.id)) {
      const removedUser = postRoomUsers.get(client.id);
      postRoomUsers.delete(client.id);

      const activeUsers = Array.from(postRoomUsers.values());
      this.server.to(data.postId).emit('presence-update', {
        postId: data.postId,
        activeUsers,
        leftUser: removedUser,
      });
    }
  }

  @SubscribeMessage('content-change')
  async handleContentChange(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      postId: string;
      title?: string;
      subtitle?: string;
      content: string;
      cursor?: any;
    },
  ) {
    if (!data?.postId || data.content === undefined) return;

    const user = await this.authenticateSocket(client);
    if (!user) return;

    const postRoomUsers = this.roomUsers.get(data.postId);
    const collabUser = postRoomUsers?.get(client.id);
    if (!collabUser || !collabUser.canEdit) return;

    const post = await this.prisma.post.findUnique({
      where: { id: data.postId },
      select: { authorId: true, collabMode: true, title: true },
    });
    if (!post) return;

    const isMasterAuthor =
      post.authorId === user.id ||
      String(user.role).toUpperCase() === Role.ADMIN;
    const mode = post.collabMode || CollabMode.FREE_FLOW;

    if (mode === CollabMode.FREE_FLOW || isMasterAuthor) {
      // Broadcast real-time change to all other peers in the room immediately
      client.to(data.postId).emit('content-update', {
        postId: data.postId,
        title: data.title,
        subtitle: data.subtitle,
        content: data.content,
        userId: user.id,
        userName: user.name,
        userColor: collabUser.color,
        cursor: data.cursor,
        timestamp: new Date().toISOString(),
      });

      // Debounce saving draft to DB (500ms debounce on backend)
      if (this.saveDebounceTimers.has(data.postId)) {
        clearTimeout(this.saveDebounceTimers.get(data.postId)!);
      }

      const timer = setTimeout(async () => {
        try {
          const wordCount = data.content
            .replace(/<[^>]*>/g, '')
            .split(/\s+/)
            .filter(Boolean).length;
          const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

          const postMeta = await this.prisma.post.findUnique({
            where: { id: data.postId },
            select: { visibility: true },
          });
          const isPrivate = postMeta?.visibility === 'PRIVATE';
          const finalContent = isPrivate
            ? this.postEncryptionService.encrypt(data.content, data.postId)
            : data.content;

          await this.prisma.post.update({
            where: { id: data.postId },
            data: {
              content: finalContent,
              ...(data.title !== undefined ? { title: data.title } : {}),
              ...(data.subtitle !== undefined ? { subtitle: data.subtitle } : {}),
              wordCount,
              readingTimeMinutes,
            },
          });

          this.server.to(data.postId).emit('save-status', {
            postId: data.postId,
            status: 'saved',
            savedAt: new Date().toISOString(),
          });
        } catch (_) {}
      }, 500);

      this.saveDebounceTimers.set(data.postId, timer);
    } else {
      // In APPROVAL_REQUIRED mode and sender is collaborator:
      // Broadcast peer-preview so author/peers see collaborator live typing preview, without saving to master DB
      client.to(data.postId).emit('collab-peer-preview', {
        postId: data.postId,
        userId: user.id,
        userName: user.name,
        userColor: collabUser.color,
        content: data.content,
        title: data.title,
        timestamp: new Date().toISOString(),
      });
    }
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { postId: string; isTyping: boolean },
  ) {
    if (!data?.postId) return;
    const postRoomUsers = this.roomUsers.get(data.postId);
    const collabUser = postRoomUsers?.get(client.id);
    if (!collabUser) return;

    client.to(data.postId).emit('user-typing', {
      postId: data.postId,
      userId: collabUser.userId,
      name: collabUser.name,
      color: collabUser.color,
      isTyping: Boolean(data.isTyping),
    });
  }

  @SubscribeMessage('mode-change')
  async handleModeChange(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { postId: string; mode: CollabMode },
  ) {
    if (!data?.postId || !data?.mode) return;
    const user = await this.authenticateSocket(client);
    if (!user) return;

    try {
      await this.collabService.setCollabMode(
        data.postId,
        user.id,
        user.role,
        data.mode,
      );

      this.server.to(data.postId).emit('mode-updated', {
        postId: data.postId,
        mode: data.mode,
        changedBy: user.name,
      });
    } catch (err: any) {
      client.emit('error', { message: err?.message || 'Failed to update collaboration mode' });
    }
  }

  @SubscribeMessage('submit-suggestion')
  async handleSubmitSuggestion(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      postId: string;
      title?: string;
      originalContent: string;
      suggestedContent: string;
      diffSummary?: string;
    },
  ) {
    if (!data?.postId || !data.originalContent || !data.suggestedContent) return;
    const user = await this.authenticateSocket(client);
    if (!user) return;

    try {
      const suggestion = await this.collabService.submitSuggestion(
        data.postId,
        user.id,
        {
          title: data.title,
          originalContent: data.originalContent,
          suggestedContent: data.suggestedContent,
          diffSummary: data.diffSummary,
        },
      );

      const pendingCount = await this.prisma.postSuggestion.count({
        where: { postId: data.postId, status: 'PENDING' },
      });

      // Broadcast new suggestion event to room
      this.server.to(data.postId).emit('new-suggestion', {
        postId: data.postId,
        suggestion,
        pendingSuggestionsCount: pendingCount,
      });

      client.emit('suggestion-submitted', {
        success: true,
        suggestionId: suggestion.id,
      });
    } catch (err: any) {
      client.emit('error', { message: err?.message || 'Failed to submit revision suggestion' });
    }
  }

  @SubscribeMessage('review-suggestion')
  async handleReviewSuggestion(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      postId: string;
      suggestionId: string;
      action: 'APPROVE' | 'REJECT';
      reviewNote?: string;
    },
  ) {
    if (!data?.postId || !data?.suggestionId || !data?.action) return;
    const user = await this.authenticateSocket(client);
    if (!user) return;

    try {
      const result = await this.collabService.reviewSuggestion(
        data.postId,
        data.suggestionId,
        user.id,
        user.role,
        { action: data.action, reviewNote: data.reviewNote },
      );

      const pendingCount = await this.prisma.postSuggestion.count({
        where: { postId: data.postId, status: 'PENDING' },
      });

      // Broadcast review result to room
      this.server.to(data.postId).emit('suggestion-reviewed', {
        postId: data.postId,
        suggestionId: data.suggestionId,
        action: data.action,
        reviewNote: data.reviewNote,
        reviewedBy: user.name,
        pendingSuggestionsCount: pendingCount,
        ...(data.action === 'APPROVE'
          ? { mergedContent: result.mergedContent }
          : {}),
      });

      // If approved, also broadcast content update so all open editors update their canvas
      if (data.action === 'APPROVE' && result.mergedContent) {
        this.server.to(data.postId).emit('content-update', {
          postId: data.postId,
          content: result.mergedContent,
          userId: user.id,
          userName: `${user.name} (Merged changes)`,
          timestamp: new Date().toISOString(),
          isApprovedMerge: true,
        });
      }
    } catch (err: any) {
      client.emit('error', { message: err?.message || 'Failed to review suggestion' });
    }
  }
}
