/**
 * Loads `.env` for processes that boot outside Nest (the TypeORM migration
 * CLI). Nest itself gets the same values through `ConfigModule.forRoot`.
 *
 * dotenv ships with `@nestjs/config`; the guard keeps the CLI usable if that
 * ever stops being true.
 */
export function loadEnvFile(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('dotenv') as typeof import('dotenv')).config();
  } catch {
    console.warn('[config] dotenv unavailable — using process.env as-is');
  }
}
