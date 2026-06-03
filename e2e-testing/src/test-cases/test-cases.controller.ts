import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UsePipes,
  ValidationPipe,
  NotFoundException,
} from '@nestjs/common';
import { TestCasesService } from './test-cases.service';
import { CreateTestCaseDto } from './dto/create-test-case.dto';
import { TestCaseResponse } from './dto/test-case-response.dto';

/**
 * REST controller for test case CRUD operations.
 * Provides endpoints to list, create, get, and delete test cases.
 */
@Controller('api/test-cases')
export class TestCasesController {
  constructor(private readonly testCasesService: TestCasesService) {}

  /**
   * GET /api/test-cases — List all test cases with statuses.
   */
  @Get()
  findAll(): TestCaseResponse[] {
    return this.testCasesService.findAll();
  }

  /**
   * POST /api/test-cases — Create a new test case.
   * Returns 201 Created with the new test case.
   * Returns 400 Bad Request if DTO validation fails.
   */
  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  create(@Body() dto: CreateTestCaseDto): TestCaseResponse {
    return this.testCasesService.create(dto);
  }

  /**
   * GET /api/test-cases/:id — Get a single test case by ID.
   * Returns 404 Not Found if the test case does not exist.
   */
  @Get(':id')
  findOne(@Param('id') id: string): TestCaseResponse {
    const testCase = this.testCasesService.findOne(id);
    if (!testCase) {
      throw new NotFoundException(`Test case with id "${id}" not found`);
    }
    return testCase;
  }

  /**
   * PUT /api/test-cases/:id — Update a test case.
   * Returns 200 OK with the updated test case.
   * Returns 404 Not Found if the test case does not exist.
   */
  @Put(':id')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  update(@Param('id') id: string, @Body() dto: CreateTestCaseDto): TestCaseResponse {
    const updated = this.testCasesService.update(id, dto);
    if (!updated) {
      throw new NotFoundException(`Test case with id "${id}" not found`);
    }
    return updated;
  }

  /**
   * DELETE /api/test-cases/:id — Delete a test case.
   * Returns 200 OK on success.
   * Returns 404 Not Found if the test case does not exist.
   */
  @Delete(':id')
  delete(@Param('id') id: string): void {
    const deleted = this.testCasesService.delete(id);
    if (!deleted) {
      throw new NotFoundException(`Test case with id "${id}" not found`);
    }
  }
}
