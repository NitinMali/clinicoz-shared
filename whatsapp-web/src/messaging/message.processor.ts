import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { MessageMedia } from 'whatsapp-web.js';
import { WhatsAppSessionService } from '../whatsapp/whatsapp-session.service';
import { MessageHistoryService } from './message-history.service';
import { MessageJobPayload } from '../whatsapp/whatsapp.interfaces';
import { QUEUE_NAMES } from '../shared/constants';

@Processor(QUEUE_NAMES.MESSAGES)
export class MessageProcessor extends WorkerHost {
  private readonly logger = new Logger(MessageProcessor.name);

  constructor(
    private readonly sessionService: WhatsAppSessionService,
    private readonly historyService: MessageHistoryService,
    @InjectQueue(QUEUE_NAMES.MESSAGES_DLQ) private readonly dlqQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<MessageJobPayload>): Promise<void> {
    const { customerId, phone, message, mediaUrl } = job.data;
    const chatId = `${phone}@c.us`;

    this.logger.log(`Processing message job ${job.id} for customer ${customerId} to ${phone}`);

    // ensureClientReady wakes up sleeping sessions if needed
    const client = await this.sessionService.ensureClientReady(customerId);

    if (mediaUrl) {
      const media = await MessageMedia.fromUrl(mediaUrl);
      await client.sendMessage(chatId, media, { caption: message });
    } else {
      await client.sendMessage(chatId, message);
    }

    this.logger.log(`Message job ${job.id} delivered successfully`);

    await this.historyService.logMessage({
      customerId,
      phone,
      message,
      mediaUrl,
      timestamp: new Date().toISOString(),
      status: 'delivered',
      jobId: job.id,
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<MessageJobPayload>, error: Error): Promise<void> {
    this.logger.warn(
      `Message job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${error.message}`,
    );

    if (job.attemptsMade >= job.opts.attempts) {
      const { customerId, phone, message, mediaUrl } = job.data;

      this.logger.error(
        `Message job ${job.id} exhausted all retries. Moving to DLQ.`,
      );

      await this.dlqQueue.add('dead-letter', {
        customerId,
        phone,
        message,
        mediaUrl,
        failedAt: new Date().toISOString(),
        failureReason: error.message,
        attempts: job.attemptsMade,
        originalJobId: job.id,
      });

      await this.historyService.logMessage({
        customerId,
        phone,
        message,
        mediaUrl,
        timestamp: new Date().toISOString(),
        status: 'failed',
        jobId: job.id,
      });
    }
  }
}
