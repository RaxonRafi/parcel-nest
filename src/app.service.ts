import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MailService } from './mail/services/mail.service';
import { RagService } from './rag/services/rag.service';

export interface HealthReport {
  status: 'ok' | 'degraded';
  /** Seconds this process has been up — small on a cold serverless start. */
  uptime: number;
  database: 'up' | 'down';
  /** False when the AI provider keys are not configured. */
  assistant: boolean;
  /** False when SMTP is not configured and mail is only logged. */
  mail: boolean;
  /** False on a serverless host, where a socket cannot stay open. */
  realtime: boolean;
}

@Injectable()
export class AppService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly ragService: RagService,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  /**
   * The database is the one dependency nothing works without, so it alone
   * decides the status. The optional integrations are reported, not judged.
   */
  async getHealth(): Promise<HealthReport> {
    const database = await this.pingDatabase();

    return {
      status: database ? 'ok' : 'degraded',
      uptime: Math.round(process.uptime()),
      database: database ? 'up' : 'down',
      assistant: this.ragService.isEnabled,
      mail: this.mailService.isConfigured,
      realtime: !process.env.VERCEL,
    };
  }

  private async pingDatabase(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
