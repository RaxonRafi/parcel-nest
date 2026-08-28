import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline schema, matching what `synchronize: true` used to create.
 *
 * Every statement is `IF NOT EXISTS`, so an existing database that was built
 * by synchronize can run this migration once to get onto the migration table
 * without any of its tables being touched.
 */
export class InitSchema1787875200000 implements MigrationInterface {
  name = 'InitSchema1787875200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "email" character varying NOT NULL,
        "password" character varying,
        "role" character varying(32) NOT NULL DEFAULT 'SENDER',
        "phone" character varying,
        "picture" character varying,
        "address" character varying,
        "isDeleted" boolean NOT NULL DEFAULT false,
        "isActive" character varying(32) NOT NULL DEFAULT 'ACTIVE',
        "isVerified" boolean NOT NULL DEFAULT false,
        "nidNumber" character varying,
        "nidImage" text NOT NULL DEFAULT '',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "UQ_users_nidNumber" UNIQUE ("nidNumber")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auth_providers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider" character varying(32) NOT NULL,
        "providerId" character varying NOT NULL,
        "userId" uuid,
        CONSTRAINT "PK_auth_providers_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_auth_providers_userId" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "parcels" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "trackingId" character varying NOT NULL,
        "senderId" uuid,
        "receiverId" uuid,
        "senderName" character varying NOT NULL,
        "receiverName" character varying NOT NULL,
        "senderPhone" character varying,
        "receiverPhone" character varying,
        "pickupAddress" text NOT NULL,
        "deliveryAddress" text NOT NULL,
        "description" text,
        "status" character varying(32) NOT NULL DEFAULT 'PENDING',
        "isBlocked" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_parcels_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_parcels_trackingId" UNIQUE ("trackingId"),
        CONSTRAINT "FK_parcels_senderId" FOREIGN KEY ("senderId")
          REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "FK_parcels_receiverId" FOREIGN KEY ("receiverId")
          REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "parcel_status_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "parcelId" uuid,
        "status" character varying(32) NOT NULL,
        "note" text,
        "changedById" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_parcel_status_logs_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_parcel_status_logs_parcelId" FOREIGN KEY ("parcelId")
          REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_parcel_status_logs_changedById" FOREIGN KEY ("changedById")
          REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

    // Lookups the app does on every request / tracking page.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_parcels_status" ON "parcels" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_parcel_status_logs_parcelId" ON "parcel_status_logs" ("parcelId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "parcel_status_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "parcels"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_providers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
