import 'dotenv/config';
import { DataSource } from 'typeorm';
import { entities } from './database/entities';
import { typeOrmConfig } from './database/typeorm-options';

export const AppDataSource = new DataSource({
  ...typeOrmConfig(),
  entities,
});
