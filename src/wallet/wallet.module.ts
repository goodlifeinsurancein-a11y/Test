import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller.js';
import { WalletService } from './wallet.service.js';
import { FinancialService } from './financial.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { ReconciliationController } from './reconciliation.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [WalletController, ReconciliationController],
  providers: [WalletService, FinancialService, ReconciliationService],
  exports: [WalletService, FinancialService, ReconciliationService],
})
export class WalletModule {}
