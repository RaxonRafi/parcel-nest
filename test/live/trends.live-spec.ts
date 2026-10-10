import { DataSource, Repository } from 'typeorm';
import { buildDataSourceOptions } from '../../src/config/database.config';
import { loadEnvFile } from '../../src/config/load-env';
import { Parcel } from '../../src/parcel/entities/parcel.entity';
import { ParcelService } from '../../src/parcel/services/parcel.service';

loadEnvFile();

const configured = !!(process.env.DATABASE_URL || process.env.DB_HOST);
const describeLive = configured ? describe : describe.skip;

/**
 * The dashboard trends are hand-written Postgres — `generate_series`, window
 * functions, `FILTER` — which the in-memory database the e2e suite runs on
 * cannot execute. This runs them against a real server instead.
 *
 * It only reads, so it is safe to point at any database: `npm run test:live`
 * uses whatever `.env` (or the environment) configures, and skips itself when
 * nothing is configured. CI runs it against a throwaway Postgres that has had
 * the migrations and the seed applied.
 */
describeLive('Dashboard trends against a real Postgres', () => {
  let dataSource: DataSource;
  let parcels: Repository<Parcel>;
  let service: ParcelService;

  beforeAll(async () => {
    dataSource = await new DataSource({
      ...buildDataSourceOptions((key) => process.env[key]),
      // Reading only: never let a test run apply a migration.
      migrationsRun: false,
    }).initialize();
    parcels = dataSource.getRepository(Parcel);

    // `getTrends` touches nothing but the repository.
    const unused = undefined as never;
    service = new ParcelService(
      parcels,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  const countSince = async (column: string, since: Date): Promise<number> => {
    const [row] = await parcels.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM parcels WHERE "${column}" >= $1`,
      [since],
    );
    return row.n;
  };

  describe.each([7, 30, 90])('over %i days', (days) => {
    it('runs, and returns numbers rather than Postgres strings', async () => {
      const trends = await service.getTrends(days);

      expect(trends.rangeDays).toBe(days);
      for (const day of trends.daily) {
        expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isInteger(day.created)).toBe(true);
        expect(Number.isInteger(day.delivered)).toBe(true);
      }
      for (const timing of trends.statusTimings) {
        expect(typeof timing.sampleSize).toBe('number');
        expect(
          timing.averageHours === null ||
            typeof timing.averageHours === 'number',
        ).toBe(true);
      }
      for (const courier of trends.courierThroughput) {
        expect(typeof courier.active).toBe('number');
        expect(typeof courier.delivered).toBe('number');
      }
      for (const amount of Object.values(trends.revenue)) {
        expect(typeof amount).toBe('number');
        expect(Number.isNaN(amount)).toBe(false);
      }
    });

    it('has one row per day with no gaps, ending today', async () => {
      const { daily } = await service.getTrends(days);

      // The window is "days ago, to the second" until today, so it spans
      // `days` or `days + 1` calendar dates depending on the time of day.
      expect(daily.length).toBeGreaterThanOrEqual(days);
      expect(daily.length).toBeLessThanOrEqual(days + 2);

      const stamps = daily.map((day) => Date.parse(`${day.date}T00:00:00Z`));
      for (let i = 1; i < stamps.length; i++) {
        expect(stamps[i] - stamps[i - 1]).toBe(86_400_000);
      }
    });

    it('agrees with a plain count of the same window', async () => {
      const since = new Date(Date.now() - days * 86_400_000);
      const [trends, created, delivered] = await Promise.all([
        service.getTrends(days),
        countSince('createdAt', since),
        countSince('deliveredAt', since),
      ]);
      const total = (key: 'created' | 'delivered') =>
        trends.daily.reduce((sum, day) => sum + day[key], 0);

      // A parcel booked between the two queries would be off by one; the
      // window boundary moving by milliseconds can do the same.
      expect(Math.abs(total('created') - created)).toBeLessThanOrEqual(1);
      expect(Math.abs(total('delivered') - delivered)).toBeLessThanOrEqual(1);
    });
  });
});
