import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AppConfigModule } from './config/config.module';
import { AuthModule } from './auth/auth.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { MessagingModule } from './messaging/messaging.module';

@Module({
  imports: [
    AppConfigModule,
    AuthModule,
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        const redisUrl = new URL(configService.get<string>('REDIS_URL'));
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port) || 6379,
            ...(redisUrl.password && { password: decodeURIComponent(redisUrl.password) }),
          },
        };
      },
      inject: [ConfigService],
    }),
    WhatsAppModule,
    MessagingModule,
  ],
})
export class AppModule {}
