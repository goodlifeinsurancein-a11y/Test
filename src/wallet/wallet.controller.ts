import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { WalletService } from './wallet.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

@Controller('wallet')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'PLAYER')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('me')
  async getMyWallet(
    @CurrentUser() authUser: { id: string; email?: string },
  ) {
    return this.walletService.getMyWallet(authUser.id);
  }

  @Get(':walletId')
  async getWalletById(
    @Param('walletId') walletId: string,
    @CurrentUser() authUser: { id: string; email?: string },
  ) {
    return this.walletService.getWalletById(authUser.id, walletId);
  }
}
