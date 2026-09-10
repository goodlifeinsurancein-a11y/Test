import { Module } from '@nestjs/common';
import { FinancialCoinController } from './financial-coin.controller.js';
import { FinancialCoinService } from './financial-coin.service.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule, WalletModule],
  controllers: [FinancialCoinController],
  providers: [FinancialCoinService],
})
export class CoinModule {}
