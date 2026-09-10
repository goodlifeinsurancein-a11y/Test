import { BadRequestException, Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { IntegratedGamesService } from './integrated-games.service.js';

@Controller('games/:game')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PLAYER')
export class IntegratedGamesController {
  constructor(private readonly games: IntegratedGamesService) {}

  @Get('state')
  async state(@Param('game') game: string) {
    return this.games.getPublicState(game);
  }

  @Get('history')
  async history(@Param('game') game: string) {
    return this.games.history(game);
  }

  @Post('bet')
  async bet(
    @Param('game') game: string,
    @CurrentUser() user: { id: string },
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.games.placeBet(game, user.id, body, key);
  }

  @Post('cashout')
  async cashout(
    @Param('game') game: string,
    @CurrentUser() user: { id: string },
    @Body() body: { betId: string; multiplier: number },
    @Headers('idempotency-key') key?: string,
  ) {
    if (game !== 'crash') throw new BadRequestException('Cashout is only available for Crash');
    return this.games.cashout(game, user.id, body.betId, body.multiplier, key);
  }
}
