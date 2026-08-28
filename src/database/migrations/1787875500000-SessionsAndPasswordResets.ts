import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backs two features that both need server-side state:
 *
 * - `refresh_tokens` makes logout mean something. Without it a token stayed
 *   valid for its full 7 days after the user signed out.
 * - `password_resets` gives a locked-out user a way back in that does not
 *   involve editing the database by hand.
 *
 * Both store only a SHA-256 of the token, so neither table is useful to
 * anyone who reads it.
 */
export class SessionsAndPasswordResets1787875500000 implements MigrationInterface {
  name = 'SessionsAndPasswordResets1787875500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refresh_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid,
        "tokenHash" character varying(64) NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "revokedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refresh_tokens_userId" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "password_resets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid,
        "tokenHash" character varying(64) NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "usedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_password_resets_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_password_resets_userId" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    // Every lookup is by hash — these are the only read paths either table has.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_tokenHash" ON "refresh_tokens" ("tokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_password_resets_tokenHash" ON "password_resets" ("tokenHash")`,
    );
    // Revoking every session for one user happens on logout-all and on reset.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_userId" ON "refresh_tokens" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "password_resets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
  }
}
