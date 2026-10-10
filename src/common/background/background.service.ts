import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';

interface VercelRequestContext {
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Vercel freezes a function the moment its response is sent, which would cut
 * an unawaited promise off mid-flight. The platform exposes the current
 * request's `waitUntil` under this symbol (it is what `@vercel/functions`
 * reads); handing it the promise keeps the function alive until it settles.
 */
function vercelWaitUntil(): VercelRequestContext['waitUntil'] {
  const holder = (
    globalThis as unknown as Record<
      symbol,
      { get?: () => VercelRequestContext | undefined } | undefined
    >
  )[Symbol.for('@vercel/request-context')];

  return holder?.get?.()?.waitUntil;
}

/**
 * Work that should not hold a response open: sending mail, re-indexing a
 * parcel for the assistant, writing notification rows.
 *
 * A task is started immediately and never awaited by the caller. It cannot
 * reject into the request either — a failure is logged under the task's label
 * and that is the end of it, which is the contract every caller here already
 * wanted ("a mail outage must not fail the write that triggered it").
 */
@Injectable()
export class BackgroundService implements OnApplicationShutdown {
  private readonly logger = new Logger(BackgroundService.name);
  private readonly pending = new Set<Promise<void>>();

  run(label: string, task: () => Promise<unknown>): void {
    const promise: Promise<void> = Promise.resolve()
      .then(task)
      .then(
        () => undefined,
        (error: unknown) => {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(`${label} failed: ${message}`);
        },
      )
      .finally(() => {
        this.pending.delete(promise);
      });

    this.pending.add(promise);
    vercelWaitUntil()?.(promise);
  }

  /** Resolves once everything started so far has settled. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  /** A long-running host finishes what it started before it exits. */
  async onApplicationShutdown(): Promise<void> {
    await this.drain();
  }
}
