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
    const { customerId, phone, message, mediaUrl, referenceId, callbackUrl } = job.data;
    const chatId = `${phone}@c.us`;
    const messageWithFooter = `${message}\n\n_Sent via Clinicoz_`;

    this.logger.log(`Processing message job ${job.id} for customer ${customerId} to ${phone}`);

    // ensureClientReady wakes up sleeping sessions if needed
    let client = await this.sessionService.ensureClientReady(customerId);

    try {
      if (mediaUrl) {
        const media = await MessageMedia.fromUrl(mediaUrl);
        await client.sendMessage(chatId, media, { caption: messageWithFooter });
      } else {
        await client.sendMessage(chatId, messageWithFooter);
      }
    } catch (e) {
      // If frame is detached, destroy and re-wake the client
      if (e.message?.includes('detached Frame') || e.message?.includes('detached')) {
        this.logger.warn(`Detached frame for ${customerId}, re-initializing...`);
        await this.sessionService.forceReconnect(customerId);
        client = await this.sessionService.ensureClientReady(customerId);

        if (mediaUrl) {
          const media = await MessageMedia.fromUrl(mediaUrl);
          await client.sendMessage(chatId, media, { caption: messageWithFooter });
        } else {
          await client.sendMessage(chatId, messageWithFooter);
        }
      } else {
        throw e;
      }
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

    // Notify caller of successful delivery
    await this.sendCallback(callbackUrl, {
      referenceId,
      status: 'delivered',
      jobId: job.id,
      phone,
      timestamp: new Date().toISOString(),
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<MessageJobPayload>, error: Error): Promise<void> {
    this.logger.warn(
      `Message job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${error.message}`,
    );

    if (job.attemptsMade >= job.opts.attempts) {
      const { customerId, phone, message, mediaUrl, referenceId, callbackUrl } = job.data;

      this.logger.error(
        `Message job ${job.id} exhausted all retries. Moving to DLQ.`,
      );

      await this.dlqQueue.add('dead-letter', {
        customerId,
        phone,
        message,
        mediaUrl,
        referenceId,
        callbackUrl,
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

      // Notify caller of permanent failure
      await this.sendCallback(callbackUrl, {
        referenceId,
        status: 'failed',
        jobId: job.id,
        phone,
        failureReason: error.message,
        attempts: job.attemptsMade,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async sendCallback(callbackUrl: string | undefined, payload: Record<string, any>): Promise<void> {
    if (!callbackUrl) return;

    try {
      const res = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      this.logger.log(`Callback sent to ${callbackUrl}: ${res.status}`);
    } catch (e) {
      this.logger.warn(`Callback failed for ${callbackUrl}: ${e.message}`);
    }
  }
}
