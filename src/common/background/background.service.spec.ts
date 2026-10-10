import { BackgroundService } from './background.service';

describe('BackgroundService', () => {
  let service: BackgroundService;

  beforeEach(() => {
    service = new BackgroundService();
  });

  it('starts the task without making the caller wait for it', async () => {
    let finished = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));

    service.run('slow', async () => {
      await gate;
      finished = true;
    });

    expect(finished).toBe(false);
    release();
    await service.drain();
    expect(finished).toBe(true);
  });

  it('swallows a failure instead of rejecting into the request', async () => {
    service.run('mail', () => Promise.reject(new Error('smtp down')));

    await expect(service.drain()).resolves.toBeUndefined();
  });

  it('swallows a task that throws before returning a promise', async () => {
    service.run('index', () => {
      throw new Error('boom');
    });

    await expect(service.drain()).resolves.toBeUndefined();
  });

  it('waits for tasks started while it was draining', async () => {
    const order: string[] = [];

    service.run('first', async () => {
      await Promise.resolve();
      service.run('second', async () => {
        await Promise.resolve();
        order.push('second');
      });
      order.push('first');
    });

    await service.drain();
    expect(order).toEqual(['first', 'second']);
  });

  it('hands the promise to Vercel when a request context is present', async () => {
    const waitUntil = jest.fn();
    const key = Symbol.for('@vercel/request-context');
    const globals = globalThis as unknown as Record<symbol, unknown>;
    globals[key] = { get: () => ({ waitUntil }) };

    try {
      service.run('mail', () => Promise.resolve());
      expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
      await service.drain();
    } finally {
      delete globals[key];
    }
  });
});
