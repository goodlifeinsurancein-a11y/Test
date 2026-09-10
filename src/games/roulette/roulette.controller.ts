import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';

import { RouletteService } from './roulette.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

@Controller('games/roulette')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RouletteController {
  constructor(
    private readonly rouletteService: RouletteService,
  ) {}

  @Get('state')
  @Roles('PLAYER')
  getState() {
    return this.rouletteService.getState();
  }

  @Get('last-result')
  @Roles('PLAYER')
  getLastResult() {
    return this.rouletteService.getLastResult();
  }

  @Post('bet')
  @Roles('PLAYER')
  async placeBet(
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      roundId: string;
      betType: string;
      betValue: string;
      amount: number;
    },
  ) {
    return this.rouletteService.placeBet(
      user.id,
      body.roundId,
      body.betType,
      body.betValue,
      body.amount,
    );
  }
}
