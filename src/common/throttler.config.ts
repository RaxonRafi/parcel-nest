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
 * Storage is in-memory, which on Vercel means counters are per warm lambda
 * rather than global: enough to blunt a scripted attack from one client, not
 * a substitute for an edge rate limit. Point the module at a shared store
 * (Redis) if that guarantee starts to matter.
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
