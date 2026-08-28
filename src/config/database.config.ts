import { join } from 'path';
import { DataSourceOptions } from 'typeorm';
import { EmailVerification } from '../auth/entities/email-verification.entity';
import { PasswordReset } from '../auth/entities/password-reset.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { AuthProvider } from '../user/entities/auth-provider.entity';
import { User } from '../user/entities/user.entity';
import { ParcelStatusLog } from '../parcel/entities/parcel-status-log.entity';
import { Parcel } from '../parcel/entities/parcel.entity';

/**
 * Entities are listed explicitly rather than discovered with a glob, so the
 * config keeps working when the app is bundled (Vercel) and when it runs from
 * `dist/` or through ts-node (the migration CLI).
 */
export const ENTITIES = [
  User,
  AuthProvider,
  Parcel,
  ParcelStatusLog,
  RefreshToken,
  PasswordReset,
  EmailVerification,
];

export const MIGRATIONS_DIR = join(__dirname, '..', 'database', 'migrations');

export const MIGRATIONS_TABLE = 'migrations';

/** Reads a value from a `ConfigService` or from a plain `process.env` map. */
export type EnvReader = (key: string) => string | undefined;

export function buildDataSourceOptions(env: EnvReader): DataSourceOptions {
  const url = env('DATABASE_URL');
  // Managed Postgres (Supabase/Neon/Render) terminates TLS with its own CA.
  const ssl = env('DB_SSL') === 'false' ? false : { rejectUnauthorized: false };

  const shared = {
    type: 'postgres' as const,
    entities: ENTITIES,
    migrations: [join(MIGRATIONS_DIR, '*.{ts,js}')],
    migrationsTableName: MIGRATIONS_TABLE,
    // Schema changes only ever come from a migration.
    synchronize: false,
    migrationsRun: env('DB_MIGRATIONS_RUN') === 'true',
    ssl,
    extra: {
      /**
       * Supabase's session-mode pooler (port 5432) allows 15 clients in total,
       * while node-postgres defaults to 10 per instance — so a dev server plus
       * one script is enough to hit `EMAXCONNSESSION`. The same arithmetic bites
       * harder on Vercel, where every warm lambda holds its own pool.
       *
       * Raise DB_POOL_MAX only if you also move to the transaction-mode pooler
       * on port 6543, which allows far more clients.
       */
      max: Number(env('DB_POOL_MAX') ?? 5),
      // Hand connections back quickly so idle instances stop holding slots.
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    },
  };

  if (url) {
    return { ...shared, url };
  }

  return {
    ...shared,
    host: env('DB_HOST'),
    port: Number(env('DB_PORT') ?? 5432),
    username: env('DB_USERNAME'),
    password: env('DB_PASSWORD'),
    database: env('DB_NAME'),
  };
}
