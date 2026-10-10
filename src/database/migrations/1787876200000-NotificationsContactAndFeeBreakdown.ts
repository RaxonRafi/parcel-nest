import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * - `notifications` keeps what used to exist only as a socket push, so a
 *   user who was offline — or on a host with no sockets at all — still finds
 *   it waiting. One row per recipient; `readAt` is per user for that reason.
 * - `contact_messages` keeps what used to exist only as an email, so a
 *   message survives a mail outage and an admin can read them in one place.
 * - `parcels.feeBreakdown` freezes how a delivery fee was made up at booking.
 */
export class NotificationsContactAndFeeBreakdown1787876200000 implements MigrationInterface {
  name = 'NotificationsContactAndFeeBreakdown1787876200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "type" character varying(32) NOT NULL,
        "title" character varying(160) NOT NULL,
        "message" text NOT NULL,
        "trackingId" character varying(64),
        "status" character varying(32),
        "readAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notifications_userId" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    // The inbox is always "this user's, newest first".
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notifications_userId_createdAt" ON "notifications" ("userId", "createdAt" DESC)`,
    );
    // The unread badge counts only rows that are still unread.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notifications_unread" ON "notifications" ("userId") WHERE "readAt" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contact_messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(80) NOT NULL,
        "email" character varying(255) NOT NULL,
        "topic" character varying(16) NOT NULL,
        "trackingId" character varying(40),
        "message" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_contact_messages_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_contact_messages_createdAt" ON "contact_messages" ("createdAt" DESC)`,
    );

    await queryRunner.query(
      `ALTER TABLE "parcels" ADD COLUMN IF NOT EXISTS "feeBreakdown" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "parcels" DROP COLUMN IF EXISTS "feeBreakdown"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "contact_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
  }
}
