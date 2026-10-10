import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { Response } from 'express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MailService } from './mail/services/mail.service';
import { RagService } from './rag/services/rag.service';

describe('AppController', () => {
  let appController: AppController;
  let dataSource: { query: jest.Mock };
  let res: { status: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    res = { status: jest.fn() };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: MailService, useValue: { isConfigured: false } },
        { provide: RagService, useValue: { isEnabled: true } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('reports ok when the database answers', async () => {
      const report = await appController.getHealth(res as unknown as Response);

      expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
      expect(report).toMatchObject({
        status: 'ok',
        database: 'up',
        assistant: true,
        mail: false,
      });
      expect(res.status).not.toHaveBeenCalled();
    });

    it('answers 503 when it does not, so a monitor sees it', async () => {
      dataSource.query.mockRejectedValue(new Error('connection refused'));

      const report = await appController.getHealth(res as unknown as Response);

      expect(report).toMatchObject({ status: 'degraded', database: 'down' });
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('says there is no realtime on a serverless host', async () => {
      const before = process.env.VERCEL;
      process.env.VERCEL = '1';

      try {
        const report = await appController.getHealth(
          res as unknown as Response,
        );
        expect(report.realtime).toBe(false);
      } finally {
        if (before === undefined) delete process.env.VERCEL;
        else process.env.VERCEL = before;
      }
    });
  });
});
