import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CreateRechargeRequestDto } from './dto/create-recharge-request.dto.js';
import { FinancialCoinService } from './financial-coin.service.js';

/** Virtual-token only: deliberately contains no withdrawal or redemption route. */
@Controller('coins')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinancialCoinController {
  constructor(private readonly coins: FinancialCoinService) {}
  @Get('balance') @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'PLAYER')
  getBalance(@CurrentUser() user: { id: string }) { return this.coins.getMyBalance(user.id); }
  @Post('recharge/request') @Roles('SUPER_ADMIN', 'ADMIN', 'PLAYER')
  createRequest(@CurrentUser() user: { id: string }, @Body() dto: CreateRechargeRequestDto, @Headers('idempotency-key') key?: string) { return this.coins.createRechargeRequest(user.id, dto.targetUserId, dto.amount, key); }
  @Post('recharge/:id/approve') @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN')
  approve(@CurrentUser() user: { id: string }, @Param('id') requestId: string, @Headers('idempotency-key') key?: string) { return this.coins.approveRechargeRequest(user.id, requestId, key); }
  @Get('recharge/requests') @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'PLAYER')
  history(@CurrentUser() user: { id: string }) { return this.coins.getRechargeRequests(user.id); }
}
