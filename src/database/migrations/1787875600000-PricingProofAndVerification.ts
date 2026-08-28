import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Three features that all need columns, applied together so a deploy is one
 * schema step rather than three:
 *
 * - pricing: weight, the fee computed from it, and cash-on-delivery
 * - proof of delivery: what was captured at handover, and when
 * - email verification: `isVerified` finally means something
 *
 * Money is `numeric(10,2)` rather than a float — binary floating point cannot
 * represent 0.10 exactly, and delivery fees are money.
 */
export class PricingProofAndVerification1787875600000 implements MigrationInterface {
  name = 'PricingProofAndVerification1787875600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Pricing ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "parcels"
        ADD COLUMN IF NOT EXISTS "weightKg" numeric(8,3) NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "deliveryFee" numeric(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "codAmount" numeric(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "isCodCollected" boolean NOT NULL DEFAULT false
    `);

    // ── Proof of delivery ──────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "parcels"
        ADD COLUMN IF NOT EXISTS "deliveryProofImages" text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "deliveryProofNote" text,
        ADD COLUMN IF NOT EXISTS "receivedBy" character varying(120),
        ADD COLUMN IF NOT EXISTS "deliveredAt" timestamptz
    `);

    // Parcels already delivered predate the column; backfill from the log so
    // `deliveredAt` is not null for rows that plainly were delivered.
    await queryRunner.query(`
      UPDATE "parcels" p
         SET "deliveredAt" = sub.at
        FROM (
          SELECT "parcelId", MAX("createdAt") AS at
            FROM "parcel_status_logs"
           WHERE status = 'DELIVERED'
           GROUP BY "parcelId"
        ) sub
       WHERE p.id = sub."parcelId"
         AND p.status = 'DELIVERED'
         AND p."deliveredAt" IS NULL
    `);

    // ── Email verification ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "email_verifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid,
        "tokenHash" character varying(64) NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "usedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_email_verifications_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_email_verifications_userId" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_email_verifications_tokenHash" ON "email_verifications" ("tokenHash")`,
    );

    // Search and filter indexes for the new list queries.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_parcels_createdAt" ON "parcels" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_users_role" ON "users" ("role")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_role"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_parcels_createdAt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "email_verifications"`);
    await queryRunner.query(`
      ALTER TABLE "parcels"
        DROP COLUMN IF EXISTS "deliveredAt",
        DROP COLUMN IF EXISTS "receivedBy",
        DROP COLUMN IF EXISTS "deliveryProofNote",
        DROP COLUMN IF EXISTS "deliveryProofImages",
        DROP COLUMN IF EXISTS "isCodCollected",
        DROP COLUMN IF EXISTS "codAmount",
        DROP COLUMN IF EXISTS "deliveryFee",
        DROP COLUMN IF EXISTS "weightKg"
    `);
  }
}
