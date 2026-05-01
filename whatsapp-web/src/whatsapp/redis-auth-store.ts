import Redis from 'ioredis';
import { REDIS_KEYS } from '../shared/constants';

const SESSION_TTL_SECONDS = 2592000; // 30 days

export class RedisAuthStore {
  constructor(private readonly redis: Redis) {}

  async sessionExists({ session }: { session: string }): Promise<boolean> {
    const exists = await this.redis.exists(REDIS_KEYS.SESSION(session));
    return exists === 1;
  }

  async save({ session, data }: { session: string; data?: any }): Promise<void> {
    const key = REDIS_KEYS.SESSION(session);
    const value = typeof data === 'string' ? data : JSON.stringify(data);
    await this.redis.set(key, value, 'EX', SESSION_TTL_SECONDS);
  }

  async extract({ session }: { session: string }): Promise<any> {
    const key = REDIS_KEYS.SESSION(session);
    const data = await this.redis.get(key);
    if (!data) {
      return null;
    }
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }

  async delete({ session }: { session: string }): Promise<void> {
    await this.redis.del(REDIS_KEYS.SESSION(session));
  }
}
