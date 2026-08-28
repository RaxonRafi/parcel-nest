import { ConfigService } from '@nestjs/config';

/**
 * Base URL of the customer-facing app — where emailed links point. Falls back
 * to the first configured CORS origin, since that is the client in practice.
 */
export function webBaseUrl(config: ConfigService): string {
  const explicit = config.get<string>('FRONTEND_URL');
  if (explicit) return stripTrailingSlash(explicit);

  const firstCorsOrigin = config
    .get<string>('CORS_ORIGIN')
    ?.split(',')[0]
    ?.trim();

  return stripTrailingSlash(firstCorsOrigin || 'http://localhost:3001');
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
