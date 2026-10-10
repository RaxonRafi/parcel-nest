import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Until `markDelivered()` existed, only the delivery-proof route stamped
 * `deliveredAt`. Parcels closed through a status update or a receiver
 * confirmation were left with `NULL`, which drops them from the dashboard's
 * delivered counts and fulfilment averages and forces the client to fall back
 * to `updatedAt`.
 *
 * Every transition writes a status-log row, so the moment of delivery is
 * recoverable: it is the first `DELIVERED` entry for the parcel. The first
 * rather than the last, because proof attached afterwards logs `DELIVERED`
 * again without the parcel having been delivered twice.
 */
export class BackfillDeliveredAt1787876000000 implements MigrationInterface {
  name = 'BackfillDeliveredAt1787876000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "parcels" p
         SET "deliveredAt" = sub.at
        FROM (
          SELECT "parcelId", MIN("createdAt") AS at
            FROM "parcel_status_logs"
           WHERE status = 'DELIVERED'
           GROUP BY "parcelId"
        ) sub
       WHERE p.id = sub."parcelId"
         AND p.status = 'DELIVERED'
         AND p."deliveredAt" IS NULL
    `);
  }

  /**
   * Deliberately empty. Nothing records which rows this filled in, and the
   * values are correct either way, so there is nothing safe to take back.
   */
  public async down(): Promise<void> {}
}
