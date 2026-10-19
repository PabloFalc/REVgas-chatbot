import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { REDIS, redisClient } from './redis.client';
import { RedisHealthService } from './redis.health';
import { RedisService } from './redis.service';

@Module({
  providers: [RedisService, redisClient, RedisHealthService],
  exports: [RedisService, RedisHealthService, REDIS],
  imports: [HealthModule],
})
export class CacheModule {}
