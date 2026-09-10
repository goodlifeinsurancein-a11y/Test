import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ReconciliationService } from './reconciliation.service.js';

@Controller('admin/reconciliation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get('wallets')
  async reconcileAllWallets() {
    return this.reconciliation.reconcileAllWallets();
  }

  @Get('wallets/:walletId')
  async reconcileWallet(@Param('walletId') walletId: string) {
    return this.reconciliation.reconcileWallet(walletId);
  }

  @Get('game-wallets')
  async reconcileAllGameWallets() {
    return this.reconciliation.reconcileAllGameWallets();
  }

  @Get('game-wallets/:gameKey')
  async reconcileGameWallet(@Param('gameKey') gameKey: string) {
    return this.reconciliation.reconcileGameWallet(gameKey);
  }
}
