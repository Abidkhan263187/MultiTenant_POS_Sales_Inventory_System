import 'dotenv/config';
import { AppDataSource } from '../data-source';
import { seed } from './seed';

AppDataSource.initialize()
  .then(async (dataSource) => {
    await dataSource.runMigrations();
    await seed(dataSource);
    await dataSource.destroy();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
