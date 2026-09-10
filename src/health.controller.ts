import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from './supabase/supabase.service.js';

@Controller()
export class HealthController {
  constructor(private readonly supabase: SupabaseService) {}
  @Get('health') health() { return { success: true, status: 'ok' }; }
  @Get('ready')
  async ready() {
    const { error } = await this.supabase.getClient().from('coin_supply').select('id').limit(1);
    if (error) throw new ServiceUnavailableException('Financial database is not ready');
    return { success: true, status: 'ready' };
  }
}
