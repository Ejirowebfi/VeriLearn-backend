import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Client as EsClient } from '@elastic/elasticsearch';
import Redis from 'ioredis';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly es: EsClient;
  private readonly redis: Redis;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    this.es = new EsClient({
      node: config.get('ELASTICSEARCH_URL', 'http://localhost:9200'),
    });
    this.redis = new Redis({
      host: config.get('redis.host', 'localhost'),
      port: config.get<number>('redis.port', 6379),
      password: config.get('redis.password') || undefined,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
  }

  @SkipThrottle()
  @Get()
  @ApiOperation({
    summary: 'Health check with DB, Redis, and Elasticsearch status',
  })
  async check() {
    const [db, redis, elasticsearch] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.checkEs(),
    ]);

    const allHealthy =
      db.status === 'ok' &&
      redis.status === 'ok' &&
      elasticsearch.status === 'ok';

    return {
      status: allHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: { db, redis, elasticsearch },
    };
  }

  private async checkDb(): Promise<{ status: string; error?: string }> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', error: err.message };
    }
  }

  private async checkRedis(): Promise<{ status: string; error?: string }> {
    try {
      await this.redis.ping();
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', error: err.message };
    }
  }

  private async checkEs(): Promise<{ status: string; error?: string }> {
    try {
      await this.es.ping();
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', error: err.message };
    }
  }
}
