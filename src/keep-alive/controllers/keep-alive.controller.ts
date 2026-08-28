import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { KeepAliveService } from '../services/keep-alive.service';

// Global prefix 'api' is applied in main.ts, so this resolves to GET /api/keep-alive.
@ApiTags('System')
@Controller()
export class KeepAliveController {
  constructor(
    private readonly keepAliveService: KeepAliveService,
    private readonly config: ConfigService,
  ) {}

  @ApiOperation({
    summary: 'Keep the database warm',
    description:
      'Called by the Vercel cron. Requires `Authorization: Bearer <CRON_SECRET>` — the JWT from the Authorize dialog does not apply here.',
  })
  @ApiHeader({
    name: 'authorization',
    required: true,
    description: 'Bearer <CRON_SECRET>',
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', example: true },
        at: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or wrong cron secret' })
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

    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException();
    }
  }
}
