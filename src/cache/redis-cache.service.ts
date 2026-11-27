import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS';

@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: Redis | null = null;
  private ready = false;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL')?.trim();
    if (!url) {
      this.logger.log('REDIS_URL is not set. Product catalog reads will use PostgreSQL.');
      return;
    }

    let reportedDown = false;
    this.client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
    });
    this.client.on('ready', () => {
      this.ready = true;
      reportedDown = false;
      this.logger.log('Redis cache connected');
    });
    this.client.on('end', () => {
      this.ready = false;
    });
    this.client.on('error', (error) => {
      this.ready = false;
      if (!reportedDown) {
        reportedDown = true;
        this.logger.warn(`Redis unavailable: ${error.message}`);
      }
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  async get(key: string): Promise<string | null> {
    if (!this.client || !this.ready) {
      return null;
    }
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.warn(`Redis get failed: ${(error as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client || !this.ready) {
      return false;
    }
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return true;
    } catch (error) {
      this.logger.warn(`Redis set failed: ${(error as Error).message}`);
      return false;
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client || !this.ready) {
      return;
    }
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.warn(`Redis del failed: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }
    this.client.disconnect();
  }
}
