import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../shared/constants';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { MessageQueueService } from './message-queue.service';
import { MessageProcessor } from './message.processor';
import { MessageHistoryService } from './message-history.service';
import { MessagingController } from './messaging.controller';
import { DlqRetryService } from './dlq-retry.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.MESSAGES }),
    BullModule.registerQueue({ name: QUEUE_NAMES.MESSAGES_DLQ }),
    WhatsAppModule,
  ],
  controllers: [MessagingController],
  providers: [MessageQueueService, MessageProcessor, MessageHistoryService, DlqRetryService],
})
export class MessagingModule {}
