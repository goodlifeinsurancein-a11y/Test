import { Controller, Get } from '@nestjs/common';
import { SupabaseService } from './supabase/supabase.service.js';

@Controller()
export class AppController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  getHello() {
    return {
      success: true,
      message: 'NestJS Backend Running',
    };
  }

  @Get('health/supabase')
  async checkSupabase() {
    const { data, error } = await this.supabase
      .getClient()
      .from('users')
      .select('id')
      .limit(1);

    if (error) {
      return {
        success: false,
        database: 'error',
        message: error.message,
      };
    }

    return {
      success: true,
      database: 'connected',
      data,
    };
  }
}
