import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TestCasesModule } from '../test-cases/test-cases.module';
import { AutomationModule } from '../automation/automation.module';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { ExecutionProcessor } from './execution.processor';

/**
 * Module wiring the ExecutionController, ExecutionService, ExecutionProcessor,
 * and BullMQ queue.
 * Imports TestCasesModule to access TestCasesService for test case validation.
 * Imports AutomationModule to access AUTOMATION_SERVICE for the processor.
 *
 * Requirements: 2.1, 2.3, 2.4
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: 'test-execution' }),
    TestCasesModule,
    AutomationModule,
  ],
  controllers: [ExecutionController],
  providers: [ExecutionService, ExecutionProcessor],
  exports: [ExecutionService],
})
export class ExecutionModule {}
