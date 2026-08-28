import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The row the Vercel cron pings daily so Supabase does not pause the project.
 * Previously applied by hand from `db/keep-alive.sql`; it lives here now so a
 * fresh database is complete after `migration:run`.
 *
 * There is no entity for this table — it is only ever touched through the
 * Supabase service-role client in `KeepAliveService`.
 */
export class KeepAliveTable1787875300000 implements MigrationInterface {
  name = 'KeepAliveTable1787875300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "keep_alive" (
        "id" integer NOT NULL,
        "ping" timestamptz DEFAULT now(),
        CONSTRAINT "PK_keep_alive_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `INSERT INTO "keep_alive" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING`,
    );

    // Only the service role key touches this table, so keep RLS on with no
    // policies. Harmless on a plain Postgres instance.
    await queryRunner.query(
      `ALTER TABLE "keep_alive" ENABLE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "keep_alive"`);
  }
}
