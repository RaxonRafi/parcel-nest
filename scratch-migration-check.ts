import dataSource from './src/database/data-source';
import { CoreDeliveryFlow1787876300000 } from './src/database/migrations/1787876300000-CoreDeliveryFlow';

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.startTransaction();
  try {
    const migration = new CoreDeliveryFlow1787876300000();
    await migration.up(runner);
    const cols = await runner.query(`SELECT column_name FROM information_schema.columns WHERE table_name='parcels' AND column_name IN ('paymentStatus','pickupZone','deliveryCodeHash','estimatedDeliveryAt','returnFee') ORDER BY 1`);
    const status = await runner.query(`SELECT "paymentStatus", count(*)::int n FROM parcels GROUP BY 1 ORDER BY 1`);
    const ledger = await runner.query(`SELECT count(*)::int n, COALESCE(sum(amount),0)::text total FROM ledger_entries`);
    const open = await runner.query(`SELECT count(*)::int n FROM parcels WHERE status NOT IN ('DELIVERED','CANCELLED') AND "deliveryFee" > 0`);
    console.log({ cols: cols.map((c: any) => c.column_name), status, ledger, openParcels: open[0].n });
    await migration.up(runner); // idempotent re-run must not double the backfill
    const again = await runner.query(`SELECT count(*)::int n FROM ledger_entries`);
    console.log('after second up, ledger rows:', again[0].n);
    await migration.down(runner);
    const gone = await runner.query(`SELECT to_regclass('public.ledger_entries') t, to_regclass('public.payments') p`);
    console.log('after down:', gone);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
