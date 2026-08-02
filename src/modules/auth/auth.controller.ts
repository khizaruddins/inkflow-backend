import { Controller, Post, Body, Res, Get, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({ status: 201, description: 'User successfully registered.' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.authService.register(dto);

    res.cookie('accessToken', tokens.accessToken, { httpOnly: true, secure: false });
    res.cookie('refreshToken', tokens.refreshToken, { httpOnly: true, secure: false });

    return { user, accessToken: tokens.accessToken };
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Authenticate user & issue JWT tokens' })
  @ApiResponse({ status: 200, description: 'User successfully logged in.' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.authService.login(dto);

    res.cookie('accessToken', tokens.accessToken, { httpOnly: true, secure: false });
    res.cookie('refreshToken', tokens.refreshToken, { httpOnly: true, secure: false });

    return { user, accessToken: tokens.accessToken };
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
    const { user, tokens } = await this.authService.refreshToken(token);

    res.cookie('accessToken', tokens.accessToken, { httpOnly: true, secure: false });
    res.cookie('refreshToken', tokens.refreshToken, { httpOnly: true, secure: false });

    return { user, accessToken: tokens.accessToken };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout user & clear httpOnly cookies' })
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user payload' })
  async getCurrentUser(@CurrentUser() user: any) {
    return user;
  }
}
