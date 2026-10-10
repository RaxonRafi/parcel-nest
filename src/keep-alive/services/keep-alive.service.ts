import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailVerificationService } from '../../auth/services/email-verification.service';
import { PasswordResetService } from '../../auth/services/password-reset.service';
import { SessionService } from '../../auth/services/session.service';
import { NotificationService } from '../../notification/services/notification.service';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const KEEP_ALIVE_ROW_ID = 1;

@Injectable()
export class KeepAliveService {
  private readonly logger = new Logger(KeepAliveService.name);
  private client: SupabaseClient | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly sessionService: SessionService,
    private readonly passwordResetService: PasswordResetService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Deletes expired refresh tokens and single-use grants, and notifications
   * past their retention. Nothing reads such a row again, so without this the
   * tables only ever grow.
   *
   * Never throws: housekeeping failing must not fail the keep-alive ping.
   */
  async pruneExpiredTokens(): Promise<number> {
    try {
      const removed = await Promise.all([
        this.sessionService.pruneExpired(),
        this.passwordResetService.pruneExpired(),
        this.emailVerificationService.pruneExpired(),
        this.notificationService.pruneOld(),
      ]);
      const total = removed.reduce((sum, count) => sum + count, 0);

      this.logger.log(`Pruned ${total} expired rows`);
      return total;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Token pruning failed: ${message}`);
      return 0;
    }
  }

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
