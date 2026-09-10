import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseService } from './supabase.service.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
