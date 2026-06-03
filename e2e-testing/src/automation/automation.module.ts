import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AutomationService } from './automation.service';
import { BrowserFactory } from './browser.factory';
import { ActionCacheService } from './action-cache.service';
import { AUTOMATION_SERVICE } from '../execution/execution.processor';

/**
 * Module wiring all automation components: AutomationService, BrowserFactory,
 * and ActionCacheService.
 *
 * Imports AiModule to provide AiService as a dependency of AutomationService.
 * ConfigModule is global, so ConfigService is available without explicit import.
 *
 * Provides the AUTOMATION_SERVICE token mapped to AutomationService so that
 * ExecutionProcessor can inject it via @Inject(AUTOMATION_SERVICE).
 *
 * Requirements: 4.1, 5.1
 */
@Module({
  imports: [AiModule],
  providers: [
    AutomationService,
    BrowserFactory,
    ActionCacheService,
    {
      provide: AUTOMATION_SERVICE,
      useExisting: AutomationService,
    },
  ],
  exports: [AutomationService, AUTOMATION_SERVICE, ActionCacheService],
})
export class AutomationModule {}
