import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Columns behind four auth changes. Everything is additive and nullable or
 * defaulted, so code from before this migration keeps running against it.
 *
 * `refresh_tokens`
 * - `familyId` ties every token in one rotation chain together, so presenting
 *   a token that was already rotated away can end the whole chain. Rows that
 *   predate this stay NULL and act as the root of their own family.
 * - `revokedReason` tells a rotation apart from a logout: only a *rotated*
 *   token turning up again is evidence of theft.
 * - `userAgent` / `ip` let a user recognise a session in "signed-in devices".
 *
 * `users`
 * - `failedLoginAttempts` / `lockedUntil` back the per-account lockout. The
 *   existing throttle is per IP and does nothing against a distributed guess.
 * - `emailNotifications` is the opt-out for parcel update emails.
 */
export class AuthHardening1787876100000 implements MigrationInterface {
  name = 'AuthHardening1787876100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
        ADD COLUMN IF NOT EXISTS "familyId" uuid,
        ADD COLUMN IF NOT EXISTS "revokedReason" character varying(16),
        ADD COLUMN IF NOT EXISTS "userAgent" character varying(255),
        ADD COLUMN IF NOT EXISTS "ip" character varying(64)
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_familyId" ON "refresh_tokens" ("familyId")`,
    );

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "failedLoginAttempts" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "lockedUntil" timestamptz,
        ADD COLUMN IF NOT EXISTS "emailNotifications" boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "emailNotifications",
        DROP COLUMN IF EXISTS "lockedUntil",
        DROP COLUMN IF EXISTS "failedLoginAttempts"
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_refresh_tokens_familyId"`);
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
        DROP COLUMN IF EXISTS "ip",
        DROP COLUMN IF EXISTS "userAgent",
        DROP COLUMN IF EXISTS "revokedReason",
        DROP COLUMN IF EXISTS "familyId"
    `);
  }
}
