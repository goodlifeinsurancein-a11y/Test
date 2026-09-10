import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto.js';
import { UpdateUserStatusDto } from './dto/update-user-status.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
  ) {}

  @Post()
  async createUser(
    @CurrentUser() authUser: { id: string },
    @Body() dto: CreateUserDto,
  ) {
    return this.usersService.createUser(
      authUser.id,
      dto,
    );
  }

  @Get()
  async listUsers(
    @CurrentUser() authUser: { id: string },
  ) {
    return this.usersService.listManagedUsers(
      authUser.id,
    );
  }

  @Get(':id')
  async getUser(
    @Param('id', new ParseUUIDPipe()) targetUserId: string,
    @CurrentUser() authUser: { id: string },
  ) {
    return this.usersService.getManagedUser(
      authUser.id,
      targetUserId,
    );
  }

  @Patch(':id')
  async updateUser(
    @Param('id', new ParseUUIDPipe()) targetUserId: string,
    @CurrentUser() authUser: { id: string },
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateUser(
      authUser.id,
      targetUserId,
      dto,
    );
  }

  @Post(':id/reset-password')
  async resetPassword(
    @Param('id', new ParseUUIDPipe()) targetUserId: string,
    @CurrentUser() authUser: { id: string },
    @Body() dto: ResetUserPasswordDto,
  ) {
    return this.usersService.resetUserPassword(
      authUser.id,
      targetUserId,
      dto.newPassword,
    );
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id', new ParseUUIDPipe()) targetUserId: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() authUser: { id: string },
  ) {
    return this.usersService.updateUserStatus(
      authUser.id,
      targetUserId,
      dto.status,
    );
  }
}
