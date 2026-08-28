import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Append-only trail of privileged actions. `actorId` is `ON DELETE SET NULL`
 * with the email denormalised alongside it — deleting an admin account must
 * not erase the record of what that account did.
 */
export class AuditLog1787875700000 implements MigrationInterface {
  name = 'AuditLog1787875700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "actorId" uuid,
        "actorEmail" character varying(255),
        "action" character varying(48) NOT NULL,
        "targetType" character varying(16) NOT NULL,
        "targetId" character varying(64) NOT NULL,
        "summary" text,
        "metadata" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_audit_logs_actorId" FOREIGN KEY ("actorId")
          REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

    // The three ways this table is read: newest first, by action, by target.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_createdAt" ON "audit_logs" ("createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_action" ON "audit_logs" ("action")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_targetId" ON "audit_logs" ("targetId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
  }
}
