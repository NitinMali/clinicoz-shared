import { Module } from '@nestjs/common';
import { TestCasesController } from './test-cases.controller';
import { TestCasesService } from './test-cases.service';

/**
 * Module wiring the TestCasesController and TestCasesService.
 * Exports TestCasesService so other modules (e.g., ExecutionModule) can use it.
 */
@Module({
  controllers: [TestCasesController],
  providers: [TestCasesService],
  exports: [TestCasesService],
})
export class TestCasesModule {}
