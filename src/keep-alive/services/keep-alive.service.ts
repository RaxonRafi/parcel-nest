import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const KEEP_ALIVE_ROW_ID = 1;

@Injectable()
export class KeepAliveService {
  private readonly logger = new Logger(KeepAliveService.name);
  private client: SupabaseClient | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): SupabaseClient {
    if (this.client) return this.client;

    const url = this.config.get<string>('SUPABASE_URL');
    // Service role key bypasses RLS so the ping does not need a signed-in user.
    const serviceRoleKey = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !serviceRoleKey) {
      throw new InternalServerErrorException(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured',
      );
    }

    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    return this.client;
  }

  async ping(): Promise<string> {
    const at = new Date().toISOString();

    // Upsert instead of update so a missing seed row heals itself.
    const { error } = await this.getClient()
      .from('keep_alive')
      .upsert({ id: KEEP_ALIVE_ROW_ID, ping: at }, { onConflict: 'id' });

    if (error) {
      this.logger.error(`Keep-alive ping failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    this.logger.log(`Keep-alive ping at ${at}`);
    return at;
  }
}
