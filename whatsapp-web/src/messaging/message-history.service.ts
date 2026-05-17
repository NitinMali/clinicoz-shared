import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_KEYS } from '../shared/constants';
import { MessageHistoryEntry } from '../whatsapp/whatsapp.interfaces';

@Injectable()
export class MessageHistoryService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async logMessage(entry: MessageHistoryEntry): Promise<void> {
    const key = REDIS_KEYS.HISTORY(entry.customerId);
    await this.redis.lpush(key, JSON.stringify(entry));
  }

  async getHistory(
    customerId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ messages: MessageHistoryEntry[]; total: number }> {
    const key = REDIS_KEYS.HISTORY(customerId);
    const [rawMessages, total] = await Promise.all([
      this.redis.lrange(key, offset, offset + limit - 1),
      this.redis.llen(key),
    ]);

    const messages = rawMessages.map(
      (raw) => JSON.parse(raw) as MessageHistoryEntry,
    );

    return { messages, total };
  }
}
