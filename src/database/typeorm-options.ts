import { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { entities } from './entities';

export function typeOrmConfig(): DataSourceOptions {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }

  return {
    type: 'postgres',
    url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    entities,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: process.env.DB_LOGGING === 'true',
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    extra: {
      max: 8,
      application_name: 'pos-system',
    },
  };
}
