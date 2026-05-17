import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { WhatsAppController } from './whatsapp.controller';

@Module({
  controllers: [WhatsAppController],
  providers: [
    WhatsAppSessionService,
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) =>
        new Redis(configService.get<string>('REDIS_URL')),
      inject: [ConfigService],
    },
  ],
  exports: [WhatsAppSessionService, 'REDIS_CLIENT'],
})
export class WhatsAppModule {}
