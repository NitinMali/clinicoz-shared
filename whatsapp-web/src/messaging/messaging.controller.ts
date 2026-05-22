import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SendMessageDto } from '../shared/dto/send-message.dto';
import { MessageQueueService } from './message-queue.service';
import { MessageHistoryService } from './message-history.service';
import { QUEUE_NAMES } from '../shared/constants';

@Controller('messaging')
export class MessagingController {
  constructor(
    private readonly messageQueueService: MessageQueueService,
    private readonly messageHistoryService: MessageHistoryService,
    @InjectQueue(QUEUE_NAMES.MESSAGES_DLQ) private readonly dlqQueue: Queue,
    @InjectQueue(QUEUE_NAMES.MESSAGES) private readonly messageQueue: Queue,
  ) {}

  @Post('send')
  @HttpCode(202)
  async send(@Body() dto: SendMessageDto) {
    const jobId = await this.messageQueueService.enqueue(dto);
    return { jobId, message: 'Message queued' };
  }

  @Get('history/:customerId')
  async getHistory(
    @Param('customerId') customerId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const parsedOffset = offset ? parseInt(offset, 10) : undefined;
    const result = await this.messageHistoryService.getHistory(
      customerId,
      parsedLimit,
      parsedOffset,
    );
    return { customerId, ...result };
  }

  @Post('dlq/retry-all')
  @HttpCode(200)
  async retryAllDlq() {
    const jobs = await this.dlqQueue.getJobs(['waiting', 'delayed', 'completed', 'failed']);
    let retried = 0;

    for (const job of jobs) {
      const data = job.data;
      if (data?.customerId && data?.phone && data?.message) {
        await this.messageQueue.add('send-message', {
          customerId: data.customerId,
          phone: data.phone,
          message: data.message,
          mediaUrl: data.mediaUrl,
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 15000 },
          removeOnComplete: true,
          removeOnFail: false,
        });
        await job.remove();
        retried++;
      }
    }

    return { retried, message: `${retried} message(s) moved back to main queue` };
  }

  @Post('dlq/retry/:jobId')
  @HttpCode(200)
  async retryDlqJob(@Param('jobId') jobId: string) {
    const job = await this.dlqQueue.getJob(jobId);
    if (!job) {
      return { error: 'Job not found in DLQ' };
    }

    const data = job.data;
    const newJob = await this.messageQueue.add('send-message', {
      customerId: data.customerId,
      phone: data.phone,
      message: data.message,
      mediaUrl: data.mediaUrl,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 15000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    await job.remove();
    return { retried: true, newJobId: newJob.id, message: 'Job moved back to main queue' };
  }

  @Get('dlq')
  async getDlqJobs() {
    const jobs = await this.dlqQueue.getJobs(['waiting', 'delayed', 'completed', 'failed']);
    return {
      count: jobs.length,
      jobs: jobs.map(j => ({
        id: j.id,
        data: j.data,
        timestamp: j.timestamp,
      })),
    };
  }
}
