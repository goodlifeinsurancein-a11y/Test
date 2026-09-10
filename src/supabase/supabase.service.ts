import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient;
  private readonly authClient: SupabaseClient;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    const url = this.config.get<string>('SUPABASE_URL');
    const secretKey = this.config.get<string>('SUPABASE_SECRET_KEY');
    const publishableKey = this.config.get<string>('SUPABASE_PUBLISHABLE_KEY');

    if (!url || !secretKey || !publishableKey) {
      throw new Error(
        'SUPABASE_URL, SUPABASE_SECRET_KEY or SUPABASE_PUBLISHABLE_KEY is missing',
      );
    }

    // Server/admin/database client.
    // Uses SECRET key and must never be exposed to the frontend.
    this.client = createClient(url, secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    // Separate authentication client.
    // Login sessions stay isolated from the server/admin client.
    this.authClient = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  getAuthClient(): SupabaseClient {
    return this.authClient;
  }
}
