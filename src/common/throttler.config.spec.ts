import { THROTTLER_CONFIG } from './throttler.config';

describe('THROTTLER_CONFIG', () => {
  const throttlers = Array.isArray(THROTTLER_CONFIG)
    ? THROTTLER_CONFIG
    : THROTTLER_CONFIG.throttlers;
  const limitOf = (name: string) =>
    throttlers.find((throttler) => throttler.name === name)?.limit;

  // Every named throttler runs on every route. A tight default on `auth` once
  // capped the whole API at 8 requests a minute.
  it.each(['auth', 'ai'])(
    'does not let %s throttle routes that never asked for it',
    (name) => {
      expect(limitOf(name)).toBe(limitOf('default'));
    },
  );
});
