import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The delivery flow beyond the happy path, and the money around it.
 *
 * - `parcels` gains zones and a service tier (priced as "inside Dhaka,
 *   standard" by default, which is exactly how every existing parcel was
 *   priced), a pickup window and an estimated delivery date, failed-attempt
 *   tracking, the hashed handover code, a return fee and how the fee is paid.
 * - `ledger_entries` records every movement of money between the company,
 *   its couriers and its merchants.
 * - `payments` records each attempt to pay a fee online.
 *
 * The ledger starts now. Parcels already finished are treated as settled
 * before it existed; parcels still open have their booking fee charged here,
 * so that when one is delivered its cash is credited net of the fee — the
 * same as a parcel booked from today.
 */
export class CoreDeliveryFlow1787876300000 implements MigrationInterface {
  name = 'CoreDeliveryFlow1787876300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "parcels"
        ADD COLUMN IF NOT EXISTS "paymentStatus" character varying(16) NOT NULL DEFAULT 'UNPAID',
        ADD COLUMN IF NOT EXISTS "returnFee" numeric(10,2),
        ADD COLUMN IF NOT EXISTS "pickupZone" character varying(16) NOT NULL DEFAULT 'DHAKA_CITY',
        ADD COLUMN IF NOT EXISTS "deliveryZone" character varying(16) NOT NULL DEFAULT 'DHAKA_CITY',
        ADD COLUMN IF NOT EXISTS "serviceTier" character varying(16) NOT NULL DEFAULT 'STANDARD',
        ADD COLUMN IF NOT EXISTS "pickupWindowStart" timestamptz,
        ADD COLUMN IF NOT EXISTS "pickupWindowEnd" timestamptz,
        ADD COLUMN IF NOT EXISTS "estimatedDeliveryAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "deliveryAttempts" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "lastFailureReason" character varying(32),
        ADD COLUMN IF NOT EXISTS "rescheduledFor" timestamptz,
        ADD COLUMN IF NOT EXISTS "deliveryCodeHash" character varying(128),
        ADD COLUMN IF NOT EXISTS "deliveryCodeAttempts" integer NOT NULL DEFAULT 0
    `);

    // A COD parcel's fee comes out of the cash; nobody pays it separately.
    await queryRunner.query(
      `UPDATE "parcels" SET "paymentStatus" = 'NOT_REQUIRED' WHERE "codAmount" > 0`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ledger_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "accountType" character varying(16) NOT NULL,
        "accountId" uuid NOT NULL,
        "type" character varying(32) NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "parcelId" uuid,
        "trackingId" character varying(64),
        "note" text,
        "reference" character varying(120),
        "createdById" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ledger_entries_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ledger_entries_accountId" FOREIGN KEY ("accountId")
          REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "FK_ledger_entries_parcelId" FOREIGN KEY ("parcelId")
          REFERENCES "parcels"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_ledger_entries_createdById" FOREIGN KEY ("createdById")
          REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
    // Balances and statements are always "this account's, newest first".
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ledger_entries_account" ON "ledger_entries" ("accountType", "accountId", "createdAt")`,
    );
    // A cancellation sums one parcel's fee entries.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ledger_entries_parcelId" ON "ledger_entries" ("parcelId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "parcelId" uuid NOT NULL,
        "payerId" uuid,
        "provider" character varying(16) NOT NULL,
        "tranId" character varying(40) NOT NULL,
        "amount" numeric(10,2) NOT NULL,
        "currency" character varying(3) NOT NULL DEFAULT 'BDT',
        "status" character varying(16) NOT NULL DEFAULT 'INITIATED',
        "valId" character varying(80),
        "bankTranId" character varying(80),
        "cardType" character varying(60),
        "failureReason" text,
        "paidAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payments_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_payments_tranId" UNIQUE ("tranId"),
        CONSTRAINT "FK_payments_parcelId" FOREIGN KEY ("parcelId")
          REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_payments_payerId" FOREIGN KEY ("payerId")
          REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payments_parcelId" ON "payments" ("parcelId")`,
    );

    // Open parcels get the booking charge they would have had.
    await queryRunner.query(`
      INSERT INTO "ledger_entries"
        ("accountType", "accountId", "type", "amount", "parcelId", "trackingId", "note")
      SELECT 'MERCHANT', p."senderId", 'DELIVERY_FEE', -p."deliveryFee", p.id, p."trackingId",
             'Opening entry: booked before the ledger existed'
        FROM "parcels" p
       WHERE p.status NOT IN ('DELIVERED', 'CANCELLED')
         AND p."deliveryFee" > 0
         AND NOT EXISTS (
           SELECT 1 FROM "ledger_entries" e
            WHERE e."parcelId" = p.id AND e."type" = 'DELIVERY_FEE'
         )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ledger_entries"`);
    await queryRunner.query(`
      ALTER TABLE "parcels"
        DROP COLUMN IF EXISTS "deliveryCodeAttempts",
        DROP COLUMN IF EXISTS "deliveryCodeHash",
        DROP COLUMN IF EXISTS "rescheduledFor",
        DROP COLUMN IF EXISTS "lastFailureReason",
        DROP COLUMN IF EXISTS "deliveryAttempts",
        DROP COLUMN IF EXISTS "estimatedDeliveryAt",
        DROP COLUMN IF EXISTS "pickupWindowEnd",
        DROP COLUMN IF EXISTS "pickupWindowStart",
        DROP COLUMN IF EXISTS "serviceTier",
        DROP COLUMN IF EXISTS "deliveryZone",
        DROP COLUMN IF EXISTS "pickupZone",
        DROP COLUMN IF EXISTS "returnFee",
        DROP COLUMN IF EXISTS "paymentStatus"
    `);
  }
}
