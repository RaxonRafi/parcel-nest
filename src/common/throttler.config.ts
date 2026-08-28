import { ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * Named throttles referenced by `@Throttle({ <name>: {...} })` on a handler.
 *
 * Storage is in-memory, which on Vercel means counters are per warm lambda
 * rather than global — enough to blunt a scripted attack from one client, not
 * a substitute for an edge rate limit. Point the module at a shared store
 * (Redis) if that guarantee starts to matter.
 */
export const THROTTLER_CONFIG: ThrottlerModuleOptions = {
  throttlers: [
    { name: 'default', ttl: 60_000, limit: 120 },
    // Credential endpoints: enough for a fumbled password, not for a script.
    { name: 'auth', ttl: 60_000, limit: 8 },
    // Every call bills an embedding plus a completion.
    { name: 'ai', ttl: 60_000, limit: 20 },
  ],
};
