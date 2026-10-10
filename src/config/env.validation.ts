import { Logger } from '@nestjs/common';

type Env = Record<string, unknown>;

/** The forms `jsonwebtoken` accepts and `TokenService` can turn into a date. */
const DURATION = /^\d+\s*[smhd]?$/;

const RAG_KEYS = [
  'PINECONE_API_KEY',
  'PINECONE_INDEX',
  'HUGGINGFACE_API_KEY',
  'GROQ_API_KEY',
];

const PLACEHOLDER = /^(replace_with|change_me|changeme|secret$)/i;

const text = (env: Env, key: string): string =>
  typeof env[key] === 'string' ? env[key].trim() : '';

/**
 * Checked once at boot by `ConfigModule`.
 *
 * Without this a missing secret only surfaced on the first request that
 * called `getOrThrow` for it — a deploy looked healthy until someone tried to
 * log in. Everything the API cannot run without is collected here and
 * reported in one message; optional integrations only warn.
 */
export function validateEnv(env: Env): Env {
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    const value = text(env, key);

    if (!value) {
      problems.push(`${key} is required`);
    } else if (PLACEHOLDER.test(value) || value.length < 32) {
      warnings.push(
        `${key} looks weak — use at least 32 random characters in production`,
      );
    }
  }

  if (
    text(env, 'JWT_ACCESS_SECRET') &&
    text(env, 'JWT_ACCESS_SECRET') === text(env, 'JWT_REFRESH_SECRET')
  ) {
    warnings.push(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are identical — an access token would verify as a refresh token',
    );
  }

  for (const key of ['JWT_ACCESS_EXPIRES', 'JWT_REFRESH_EXPIRES']) {
    const value = text(env, key);

    if (!value) {
      problems.push(`${key} is required`);
    } else if (!DURATION.test(value)) {
      problems.push(`${key} must look like 15m, 12h, 7d or a number of seconds`);
    }
  }

  const rounds = Number(text(env, 'BCRYPT_SALT_ROUND'));
  if (!text(env, 'BCRYPT_SALT_ROUND')) {
    problems.push('BCRYPT_SALT_ROUND is required');
  } else if (!Number.isInteger(rounds) || rounds < 4 || rounds > 15) {
    problems.push('BCRYPT_SALT_ROUND must be a whole number from 4 to 15');
  }

  if (!text(env, 'DATABASE_URL')) {
    const missing = ['DB_HOST', 'DB_USERNAME', 'DB_NAME'].filter(
      (key) => !text(env, key),
    );

    if (missing.length) {
      problems.push(
        `Set DATABASE_URL, or the discrete values (missing ${missing.join(', ')})`,
      );
    }
  }

  for (const key of ['PORT', 'DB_PORT', 'SMTP_PORT', 'DB_POOL_MAX']) {
    const value = text(env, key);

    if (value && !(Number.isInteger(Number(value)) && Number(value) > 0)) {
      problems.push(`${key} must be a positive whole number`);
    }
  }

  const ragSet = RAG_KEYS.filter((key) => text(env, key));
  if (ragSet.length > 0 && ragSet.length < RAG_KEYS.length) {
    warnings.push(
      `The assistant needs all of ${RAG_KEYS.join(', ')}; only some are set, so it stays off`,
    );
  }

  if (text(env, 'NODE_ENV') === 'production' && !text(env, 'CORS_ORIGIN')) {
    warnings.push(
      'CORS_ORIGIN is empty — the built-in development origins are being used',
    );
  }

  const logger = new Logger('Config');
  for (const warning of warnings) {
    logger.warn(warning);
  }

  if (problems.length) {
    throw new Error(
      `Invalid environment:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }

  return env;
}
