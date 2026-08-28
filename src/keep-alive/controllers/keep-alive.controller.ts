import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { KeepAliveService } from '../services/keep-alive.service';

// Global prefix 'api' is applied in main.ts, so this resolves to GET /api/keep-alive.
@Controller()
export class KeepAliveController {
  constructor(
    private readonly keepAliveService: KeepAliveService,
    private readonly config: ConfigService,
  ) {}

  @Get('keep-alive')
  async keepAlive(@Headers('authorization') auth?: string) {
    this.assertCronRequest(auth);

    const at = await this.keepAliveService.ping();
    return { ok: true, at };
  }

  private assertCronRequest(auth?: string): void {
    const secret = this.config.get<string>('CRON_SECRET');

    // Without a configured secret the endpoint stays closed rather than
    // accepting the literal string 'Bearer undefined'.
    if (!secret || !auth) {
      throw new UnauthorizedException();
    }

    const expected = Buffer.from(`Bearer ${secret}`);
    const received = Buffer.from(auth);

    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new UnauthorizedException();
    }
  }
}
