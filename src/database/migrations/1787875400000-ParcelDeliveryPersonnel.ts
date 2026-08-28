import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the courier assignment column to `parcels`.
 *
 * `ON DELETE SET NULL` mirrors `parcel_status_logs.changedById`: removing a
 * courier account must not cascade away the parcels they were carrying.
 */
export class ParcelDeliveryPersonnel1787875400000 implements MigrationInterface {
  name = 'ParcelDeliveryPersonnel1787875400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "parcels" ADD COLUMN IF NOT EXISTS "deliveryPersonnelId" uuid`,
    );

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_parcels_deliveryPersonnelId'
        ) THEN
          ALTER TABLE "parcels"
            ADD CONSTRAINT "FK_parcels_deliveryPersonnelId"
            FOREIGN KEY ("deliveryPersonnelId") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    // Couriers read their own queue on every app open — this is the hot path.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_parcels_deliveryPersonnelId" ON "parcels" ("deliveryPersonnelId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_parcels_deliveryPersonnelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "parcels" DROP CONSTRAINT IF EXISTS "FK_parcels_deliveryPersonnelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "parcels" DROP COLUMN IF EXISTS "deliveryPersonnelId"`,
    );
  }
}
