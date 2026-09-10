import {
  Body,
  Controller,
  Get,
  Post,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { TeenPattiService } from './teen-patti.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';


interface CurrentUserPayload {
  id: string;
  role: string;
}

@Controller('games/teen-patti')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PLAYER')
export class TeenPattiController {
  constructor(
    private readonly service: TeenPattiService,
  ) {}

  @Get('state')
  getState() {
    return this.service.getState();
  }

  @Get('result')
  getLastResult() {
    return this.service.getLastResult();
  }

  @Post('bet')
  async placeBet(
    @CurrentUser() user: CurrentUserPayload,
    @Body()
    body: {
      amount: number;
    },
  ) {
    if (
      typeof body.amount !== 'number' ||
      !Number.isFinite(body.amount)
    ) {
      throw new BadRequestException(
        'amount must be a valid number',
      );
    }

    return this.service.placeBet(
      user.id,
      '', // walletId not needed - financial service looks up wallet
      body.amount,
    );
  }
}
