import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { buildParcels, buildStatusLogs, buildUsers } from '../seeds/dummy-data';

/**
 * Development seed: 40 users and 200 parcels spread over the last 90 days.
 *
 * **This is inert unless `SEED_DUMMY_DATA=true`.** Migrations run on every
 * deploy, and a seed that fires in production is not something you can undo by
 * apologising — so the guard is the default and the opt-in is explicit.
 *
 * Everything it writes is tagged so `down()` can remove exactly its own rows
 * and nothing else: users at `@seed.local`, parcels prefixed `TRK-SEED-`.
 *
 * Dates are backdated across the window so `GET /api/dashboard/trends` has a
 * real series to draw rather than a single spike at install time.
 */
export class SeedDummyData1787875800000 implements MigrationInterface {
  name = 'SeedDummyData1787875800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (process.env.SEED_DUMMY_DATA !== 'true') {
      console.log(
        '[seed] skipped — set SEED_DUMMY_DATA=true to insert dummy data',
      );
      return;
    }

    const existing = await queryRunner.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE email LIKE '%@seed.local'`,
    );
    if (existing[0].n > 0) {
      console.log('[seed] skipped — seed data is already present');
      return;
    }

    // One hash for every seed account: they all share the password below, and
    // hashing 40 times at cost 10 would add ~4s to the migration for nothing.
    const password = await bcrypt.hash('SeedPass123!', 10);

    const users = buildUsers(password);
    await queryRunner.query(
      `INSERT INTO users
         ("id","name","email","password","role","phone","address",
          "isDeleted","isActive","isVerified","nidImage","createdAt","updatedAt")
       SELECT (r->>'id')::uuid, r->>'name', r->>'email', r->>'password',
              r->>'role', r->>'phone', r->>'address',
              false, r->>'isActive', (r->>'isVerified')::boolean, '',
              (r->>'createdAt')::timestamptz, (r->>'createdAt')::timestamptz
         FROM jsonb_array_elements($1::jsonb) AS r`,
      [JSON.stringify(users)],
    );

    // Credentials provider row, so seed accounts can actually sign in.
    await queryRunner.query(
      `INSERT INTO auth_providers ("provider","providerId","userId")
       SELECT 'credentials', email, id FROM users WHERE email LIKE '%@seed.local'`,
    );

    const senders = users.filter((u) => u.role === 'SENDER');
    const receivers = users.filter((u) => u.role === 'RECEIVER');
    const couriers = users.filter((u) => u.role === 'DELIVERY_PERSONNEL');

    const parcels = buildParcels(senders, receivers, couriers);
    await queryRunner.query(
      `INSERT INTO parcels
         ("id","trackingId","senderId","receiverId","deliveryPersonnelId",
          "senderName","receiverName","senderPhone","receiverPhone",
          "pickupAddress","deliveryAddress","description","status","isBlocked",
          "weightKg","deliveryFee","codAmount","isCodCollected",
          "deliveryProofImages","receivedBy","deliveredAt","createdAt","updatedAt")
       SELECT (r->>'id')::uuid, r->>'trackingId', (r->>'senderId')::uuid,
              (r->>'receiverId')::uuid, NULLIF(r->>'courierId','')::uuid,
              r->>'senderName', r->>'receiverName', r->>'senderPhone', r->>'receiverPhone',
              r->>'pickupAddress', r->>'deliveryAddress', r->>'description',
              r->>'status', (r->>'isBlocked')::boolean,
              (r->>'weightKg')::numeric, (r->>'deliveryFee')::numeric,
              (r->>'codAmount')::numeric, (r->>'isCodCollected')::boolean,
              '', NULLIF(r->>'receivedBy',''),
              NULLIF(r->>'deliveredAt','')::timestamptz,
              (r->>'createdAt')::timestamptz, (r->>'updatedAt')::timestamptz
         FROM jsonb_array_elements($1::jsonb) AS r`,
      [JSON.stringify(parcels)],
    );

    // A log entry per status the parcel actually passed through, timestamped in
    // order — the dashboard's dwell-time query reads consecutive entries, so
    // dumping them all at one instant would make every status look instant.
    const logs = buildStatusLogs(parcels);
    await queryRunner.query(
      `INSERT INTO parcel_status_logs ("parcelId","status","note","changedById","createdAt")
       SELECT (r->>'parcelId')::uuid, r->>'status', r->>'note',
              NULLIF(r->>'changedById','')::uuid, (r->>'createdAt')::timestamptz
         FROM jsonb_array_elements($1::jsonb) AS r`,
      [JSON.stringify(logs)],
    );

    console.log(
      `[seed] inserted ${users.length} users, ${parcels.length} parcels, ${logs.length} status logs`,
    );
  }

  /** Removes only what `up()` created, identified by the seed markers. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM parcel_status_logs
        WHERE "parcelId" IN (SELECT id FROM parcels WHERE "trackingId" LIKE 'TRK-SEED-%')`,
    );
    await queryRunner.query(
      `DELETE FROM parcels WHERE "trackingId" LIKE 'TRK-SEED-%'`,
    );
    await queryRunner.query(
      `DELETE FROM auth_providers
        WHERE "userId" IN (SELECT id FROM users WHERE email LIKE '%@seed.local')`,
    );
    await queryRunner.query(
      `DELETE FROM users WHERE email LIKE '%@seed.local'`,
    );
  }
}
