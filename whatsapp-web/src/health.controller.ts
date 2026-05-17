import { Controller, Get, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { Public } from './auth/public.decorator';

@Controller('health')
export class HealthController {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  @Public()
  @Get()
  async check() {
    let redisStatus = 'down';

    try {
      const pong = await this.redis.ping();
      if (pong === 'PONG') redisStatus = 'up';
    } catch (e) {
      redisStatus = 'down';
    }

    const healthy = redisStatus === 'up';

    return {
      status: healthy ? 'ok' : 'degraded',
      uptime: Math.floor(process.uptime()),
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    };
  }
}
