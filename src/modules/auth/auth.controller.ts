import { Controller, Post, Body, Res, Get, Patch, Put, UseGuards, Req, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
    const isProduction = process.env.NODE_ENV === 'production';
    const sameSiteMode: 'none' | 'lax' = isProduction ? 'none' : 'lax';
    const accessCookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: sameSiteMode,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    };
    const refreshCookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: sameSiteMode,
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    };
    res.cookie('accessToken', accessToken, accessCookieOptions);
    res.cookie('refreshToken', refreshToken, refreshCookieOptions);
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({ status: 201, description: 'User successfully registered.' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.authService.register(dto);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return { user, tokens };
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Authenticate user & issue JWT tokens' })
  @ApiResponse({ status: 200, description: 'User successfully logged in.' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.authService.login(dto);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return { user, tokens };
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password for user account' })
  @ApiResponse({ status: 200, description: 'Password reset successfully.' })
  async resetPassword(@Body() body: { email: string; newPassword: string }) {
    return this.authService.resetPassword(body);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access & refresh tokens' })
  @ApiResponse({ status: 200, description: 'Tokens successfully refreshed.' })
  async refresh(
    @Req() req: Request,
    @Body('refreshToken') refreshTokenFromBody: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.refreshToken || refreshTokenFromBody;
    const { user, tokens } = await this.authService.refreshTokens(token);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return { user, tokens };
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: 'Logout user & clear httpOnly cookies' })
  async logout(@Res({ passthrough: true }) res: Response) {
    const isProduction = process.env.NODE_ENV === 'production';
    const sameSiteMode: 'none' | 'lax' = isProduction ? 'none' : 'lax';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: sameSiteMode,
      path: '/',
    };
    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);
    res.clearCookie('accessToken', { path: '/' });
    res.clearCookie('refreshToken', { path: '/' });
    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user full profile' })
  async me(@CurrentUser('id') userId: string) {
    return this.authService.getUserMe(userId);
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current authenticated user profile' })
  @ApiResponse({ status: 200, description: 'User profile successfully updated.' })
  async updateProfilePatch(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(userId, dto);
  }

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current authenticated user profile via PUT' })
  @ApiResponse({ status: 200, description: 'User profile successfully updated.' })
  async updateProfilePut(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(userId, dto);
  }

  @Get('users/search')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search users by name, username, or email for private blog sharing' })
  async searchUsers(
    @CurrentUser('id') currentUserId: string,
    @Query('q') q?: string,
  ) {
    return this.authService.searchUsers(currentUserId, q);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('users/by-username/:username')
  @ApiOperation({ summary: 'Get public user profile & publications by username' })
  async getUserByUsername(
    @Param('username') username: string,
    @CurrentUser() currentUser?: any,
  ) {
    return this.authService.getUserByUsername(username, currentUser);
  }

  @Public()
  @Get('users/:idOrUsername/followers')
  @ApiOperation({ summary: 'Get followers list for a user' })
  async getUserFollowers(@Param('idOrUsername') idOrUsername: string) {
    return this.authService.getUserFollowers(idOrUsername);
  }

  @Public()
  @Get('users/:idOrUsername/following')
  @ApiOperation({ summary: 'Get following list for a user' })
  async getUserFollowing(@Param('idOrUsername') idOrUsername: string) {
    return this.authService.getUserFollowing(idOrUsername);
  }

  @Post('users/:targetUserId/follow')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle follow status for a user' })
  async toggleFollow(
    @CurrentUser('id') currentUserId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.authService.toggleFollowUser(currentUserId, targetUserId);
  }
}
