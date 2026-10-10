import { MigrationInterface, QueryRunner } from 'typeorm';

/** Every `timestamp without time zone` column the first migration created. */
const COLUMNS: [table: string, column: string][] = [
  ['users', 'createdAt'],
  ['users', 'updatedAt'],
  ['parcels', 'createdAt'],
  ['parcels', 'updatedAt'],
  ['parcel_status_logs', 'createdAt'],
];

/**
 * Two schema corrections:
 *
 * - The original tables stored `timestamp without time zone` while everything
 *   added later uses `timestamptz`. node-postgres reads a zone-less value in
 *   the Node process's local zone, so the same row came back as a different
 *   instant on a developer machine than on the server.
 *
 *   The cast interprets each existing value in the database session's time
 *   zone — the same zone `now()` wrote it in — so no instant moves, provided
 *   the session zone has not been changed since the rows were written.
 *
 * - `parcels.senderId` and `parcels.receiverId` back the "my parcels" and
 *   "incoming parcels" lists and had no index.
 */
export class TimestamptzAndParcelPartyIndexes1787875900000 implements MigrationInterface {
  name = 'TimestamptzAndParcelPartyIndexes1787875900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamptz`,
      );
    }

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_parcels_senderId" ON "parcels" ("senderId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_parcels_receiverId" ON "parcels" ("receiverId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_parcels_receiverId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_parcels_senderId"`);

    for (const [table, column] of COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamp`,
      );
    }
  }
}
