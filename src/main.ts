import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { ensureLocalRedis } from './cache/ensure-local-redis';

async function bootstrap(): Promise<void> {
  await ensureLocalRedis();
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const config = app.get(ConfigService);
  if (config.get<string>('DB_MIGRATE_ON_START', 'true') !== 'false') {
    await app.get(DataSource).runMigrations();
  }

  const port = Number(config.get<string>('PORT', '3000'));
  await app.listen(port);
  console.log(`POS API listening on http://localhost:${port}/api`);
}

bootstrap();
