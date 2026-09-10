import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { FinancialRouletteService } from './financial-roulette.service.js';

@Controller('games/roulette') @UseGuards(JwtAuthGuard, RolesGuard) @Roles('PLAYER')
export class FinancialRouletteController {
  constructor(private readonly roulette: FinancialRouletteService) {}
  @Get('state') state() { return this.roulette.getState(); }
  @Get('history') history() { return this.roulette.history(); }
  @Get('last-result') lastResult() { return this.roulette.getLastResult(); }
  @Post('bet') bet(@CurrentUser() user: { id: string }, @Headers('idempotency-key') key: string | undefined, @Body() body: { roundId: string; betType: string; betValue: string; amount: number }) { return this.roulette.placeBet(user.id, body.roundId, body.betType, body.betValue, body.amount, key); }
}
