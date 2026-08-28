import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../config/database.config';
import { loadEnvFile } from '../config/load-env';

loadEnvFile();

/**
 * DataSource used by the TypeORM CLI. Every `migration:*` npm script points
 * here via `-d src/database/data-source.ts`.
 *
 * Exported once on purpose: the CLI refuses a module that exports more than
 * one `DataSource`, which is what a named export plus a default one is.
 */
const dataSource = new DataSource(
  buildDataSourceOptions((key) => process.env[key]),
);

export default dataSource;
