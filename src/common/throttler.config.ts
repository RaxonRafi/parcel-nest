import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ThrottlerModuleOptions } from '@nestjs/throttler';

/** The ceiling every route gets unless a handler asks for a tighter one. */
const BASELINE = { ttl: 60_000, limit: 120 };

/**
 * Named throttles referenced by `@Throttle({ <name>: {...} })` on a handler.
 *
 * Every throttler listed here is applied to every route, not only to the
 * handlers that name it. `auth` and `ai` therefore carry the baseline as their
 * default and only bite where a handler overrides them with a tighter
 * limit; giving them a tight default here throttles the whole API to it.
 *
 * Storage is in-memory unless `REDIS_URL` is set — see `throttlerOptions`.
 */
export const THROTTLER_NAMES = [
  'default',
  // Credential endpoints: tightened per handler to 8 a minute.
  'auth',
  // Every call bills an embedding plus a completion: 20 a minute per handler.
  'ai',
] as const;

export const THROTTLER_CONFIG: ThrottlerModuleOptions = {
  throttlers: THROTTLER_NAMES.map((name) => ({ name, ...BASELINE })),
};

/**
 * In-memory counters live in one process: on Vercel that is one warm lambda,
 * and behind a load balancer it is one instance, so a client spread across
 * several gets the limit several times over. With `REDIS_URL` set the counters
 * move to Redis and the limit holds across all of them.
 */
export function throttlerOptions(redisUrl?: string): ThrottlerModuleOptions {
  if (!redisUrl) return THROTTLER_CONFIG;

  return {
    ...THROTTLER_CONFIG,
    storage: new ThrottlerStorageRedisService(redisUrl, {
      // Fail the one request rather than queueing commands while Redis is
      // away — a rate limiter must not become the outage.
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    }),
  };
}
