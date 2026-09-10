import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { Roles } from './decorators/roles.decorator.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { BootstrapOwnerDto } from './dto/bootstrap-owner.dto.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(
      dto.email,
      dto.password,
    );
  }

  @Post('bootstrap-owner')
  async bootstrapOwner(
    @Headers('x-owner-bootstrap-secret') bootstrapSecret: string,
    @Body() dto: BootstrapOwnerDto,
  ) {
    const expectedSecret =
      this.config.get<string>('OWNER_BOOTSTRAP_SECRET');

    if (
      !expectedSecret ||
      !bootstrapSecret ||
      bootstrapSecret !== expectedSecret
    ) {
      throw new HttpException(
        'Unauthorized',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return this.authService.bootstrapOwner(
      dto.email,
      dto.password,
      dto.fullName,
    );
  }

  @Get('owner-test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  ownerTest() {
    return {
      success: true,
      message: 'OWNER access granted',
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(
    @CurrentUser()
    authUser: {
      id: string;
      email?: string;
    },
  ) {
    const profile =
      await this.authService.getAuthenticatedProfile(authUser.id);

    if (!profile) {
      throw new HttpException(
        'User profile not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      success: true,
      authUser: {
        id: authUser.id,
        email: authUser.email,
      },
      profile,
    };
  }


}
