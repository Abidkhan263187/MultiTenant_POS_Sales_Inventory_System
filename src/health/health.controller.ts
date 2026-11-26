import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisCacheService } from '../cache/redis-cache.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: RedisCacheService,
  ) {}

  @Get()
  async health() {
    await this.dataSource.query('SELECT 1');
    return {
      status: 'ok',
      database: 'up',
      redis: this.cache.isReady() ? 'up' : 'disabled',
    };
  }
}
