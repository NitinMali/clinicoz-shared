import { Module } from '@nestjs/common';
import { AiService } from './ai.service';

/**
 * Module providing the AiService for Amazon Bedrock Claude integration.
 * Exports AiService so it can be used by AutomationModule.
 *
 * ConfigModule is global, so ConfigService is available without explicit import.
 */
@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
