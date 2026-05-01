import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { SendMessageDto } from '../shared/dto/send-message.dto';
import { MessageQueueService } from './message-queue.service';
import { MessageHistoryService } from './message-history.service';

@Controller('messaging')
export class MessagingController {
  constructor(
    private readonly messageQueueService: MessageQueueService,
    private readonly messageHistoryService: MessageHistoryService,
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
}
