import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppService, HealthReport } from './app.service';

@ApiTags('System')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Answers as long as the process is up. Use `GET /api/health` to learn whether it can actually serve requests.',
  })
  @ApiResponse({
    status: 200,
    schema: { type: 'string', example: 'Hello World!' },
  })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @ApiOperation({
    summary: 'Health check',
    description:
      'Runs a query against the database. `200` with `status: "ok"` when it answers, `503` with `status: "degraded"` when it does not. The optional integrations (assistant, mail, realtime) are reported but never fail the check.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'degraded'] },
        uptime: { type: 'number', example: 4211 },
        database: { type: 'string', enum: ['up', 'down'] },
        assistant: { type: 'boolean' },
        mail: { type: 'boolean' },
        realtime: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 503, description: 'The database did not answer' })
  // Uptime monitors poll this; it must never be the thing that gets limited.
  @SkipThrottle()
  @Get('health')
  async getHealth(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthReport> {
    const report = await this.appService.getHealth();

    if (report.status !== 'ok') {
      res.status(503);
    }

    return report;
  }
}
