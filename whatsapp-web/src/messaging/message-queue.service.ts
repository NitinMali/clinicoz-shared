import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { SendMessageDto } from '../shared/dto/send-message.dto';
import { QUEUE_NAMES, REDIS_KEYS } from '../shared/constants';
import { ConnectionStatus } from '../whatsapp/whatsapp.interfaces';

@Injectable()
export class MessageQueueService {
  constructor(
    @InjectQueue(QUEUE_NAMES.MESSAGES) private readonly messageQueue: Queue,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async enqueue(dto: SendMessageDto): Promise<string> {
    const status = await this.redis.get(REDIS_KEYS.STATUS(dto.customerId));

    if (status !== ConnectionStatus.CONNECTED) {
      throw new ConflictException('Customer is not connected');
    }

    const job = await this.messageQueue.add('send-message', {
      customerId: dto.customerId,
      phone: dto.phone,
      message: dto.message,
      mediaUrl: dto.mediaUrl,
      referenceId: dto.referenceId,
      callbackUrl: dto.callbackUrl,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    return job.id;
  }
}
