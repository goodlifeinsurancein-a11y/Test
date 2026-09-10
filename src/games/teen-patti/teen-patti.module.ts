import { Module } from '@nestjs/common';
import { WalletModule } from '../../wallet/wallet.module.js';
import { TeenPattiController } from './teen-patti.controller.js';
import { TeenPattiRoundEngine } from './teen-patti.round.engine.js';
import { TeenPattiService } from './teen-patti.service.js';

@Module({
  imports: [WalletModule],
  controllers: [TeenPattiController],
  providers: [
    TeenPattiRoundEngine,
    TeenPattiService,
  ],
  exports: [
    TeenPattiRoundEngine,
    TeenPattiService,
  ],
})
export class TeenPattiModule {}
