import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { BullModule } from '@nestjs/bullmq';
import * as path from 'path';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { TestCasesModule } from './test-cases/test-cases.module';
import { ExecutionModule } from './execution/execution.module';
import { AutomationModule } from './automation/automation.module';
import { AiModule } from './ai/ai.module';

/**
 * Root application module wiring all feature modules together.
 * Requirements: 9.1, 9.3
 */
@Module({
  imports: [
    // Global configuration module (task 1.2)
    ConfigModule,

    // Serve dashboard from public/ directory at root path (Requirement 9.1)
    ServeStaticModule.forRoot({
      rootPath: path.join(__dirname, '..', 'public'),
      serveRoot: '/',
      exclude: ['/api/(.*)'],
    }),

    // BullMQ Redis connection using config values (Requirement 9.3)
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.redisHost,
          port: configService.redisPort,
        },
      }),
      inject: [ConfigService],
    }),

    // Test case management module (task 2.5)
    TestCasesModule,

    // Execution module with BullMQ queue (task 4.4)
    ExecutionModule,

    // Automation module: Stagehand + Playwright orchestration (task 8.5)
    AutomationModule,

    // AI module: Amazon Bedrock Claude integration (task 7.1)
    AiModule,
  ],
})
export class AppModule {}
