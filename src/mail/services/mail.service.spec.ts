import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BackgroundService } from '../../common/background/background.service';
import { MailService } from './mail.service';

describe('MailService', () => {
  let background: BackgroundService;
  let service: MailService;
  let sendMail: jest.Mock;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();

    background = new BackgroundService();
    service = new MailService(
      {
        get: (key: string) =>
          key === 'SMTP_FROM' ? 'Parcel <no-reply@parcel.app>' : undefined,
      } as unknown as ConfigService,
      background,
    );
    sendMail = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const configure = () => {
    (service as unknown as { transporter: unknown }).transporter = { sendMail };
  };

  it('logs instead of sending when SMTP is not configured', async () => {
    service.onModuleInit();

    await service.send('a@b.c', 'Hello', '<p>hi</p>', 'hi');

    expect(service.isConfigured).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mail not sent'));
  });

  it('sends with the configured from address', async () => {
    configure();

    await service.send('a@b.c', 'Hello', '<p>hi</p>', 'hi');

    expect(sendMail).toHaveBeenCalledWith({
      from: 'Parcel <no-reply@parcel.app>',
      to: 'a@b.c',
      subject: 'Hello',
      html: '<p>hi</p>',
      text: 'hi',
    });
  });

  it('adds a reply-to only when asked', async () => {
    configure();

    await service.send('support@parcel.app', 'Contact', '', '', {
      replyTo: 'zain@example.com',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: 'zain@example.com' }),
    );
  });

  it('queues without waiting, and delivers behind the caller', async () => {
    configure();

    service.queue('a@b.c', 'Hello', '<p>hi</p>', 'hi');
    expect(sendMail).not.toHaveBeenCalled();

    await background.drain();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('never lets a delivery failure reach whoever queued it', async () => {
    configure();
    sendMail.mockRejectedValue(new Error('connection refused'));

    expect(() => service.queue('a@b.c', 'Hello', '', '')).not.toThrow();
    await expect(background.drain()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Email "Hello" to a@b.c failed: connection refused'),
    );
  });
});
