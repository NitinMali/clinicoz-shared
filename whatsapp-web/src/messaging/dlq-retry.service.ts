import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../shared/constants';

// Retry DLQ every 2 minutes
const DLQ_RETRY_INTERVAL_MS = 2 * 60 * 1000;

@Injectable()
export class DlqRetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DlqRetryService.name);
  private intervalId: NodeJS.Timeout;

  constructor(
    @InjectQueue(QUEUE_NAMES.MESSAGES_DLQ) private readonly dlqQueue: Queue,
    @InjectQueue(QUEUE_NAMES.MESSAGES) private readonly messageQueue: Queue,
  ) {}

  onModuleInit() {
    this.intervalId = setInterval(() => this.retryDlqJobs(), DLQ_RETRY_INTERVAL_MS);
    this.logger.log(`DLQ auto-retry enabled (every ${DLQ_RETRY_INTERVAL_MS / 1000}s)`);
  }

  onModuleDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private async retryDlqJobs(): Promise<void> {
    try {
      const jobs = await this.dlqQueue.getJobs(['waiting', 'delayed']);
      if (jobs.length === 0) return;

      this.logger.log(`Found ${jobs.length} job(s) in DLQ, retrying...`);

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
        }
      }

      this.logger.log(`Retried ${jobs.length} DLQ job(s)`);
    } catch (e) {
      this.logger.error(`DLQ retry failed: ${e.message}`);
    }
  }
}
