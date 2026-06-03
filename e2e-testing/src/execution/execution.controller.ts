import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Res,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { ExecutionService } from './execution.service';
import { ExecutionResponse } from './dto/execution-response.dto';
import { ActionCacheService } from '../automation/action-cache.service';

/**
 * Job status response returned by GET /api/jobs/:jobId.
 */
export interface JobStatusResponse {
  jobId: string;
  state: string;
  progress: number | object | string | boolean;
}

/**
 * REST controller for test execution operations.
 * Provides endpoints to trigger test execution and query job status.
 *
 * Requirements: 2.1, 2.3, 2.4
 */
@Controller('api')
export class ExecutionController {
  constructor(
    private readonly executionService: ExecutionService,
    @InjectQueue('test-execution') private readonly queue: Queue,
    private readonly actionCacheService: ActionCacheService,
  ) {}

  /**
   * POST /api/test-cases/:id/execute — Trigger test execution.
   * Returns 202 Accepted with the job ID on successful enqueue.
   */
  @Post('test-cases/:id/execute')
  @HttpCode(202)
  async execute(@Param('id') id: string): Promise<ExecutionResponse> {
    return this.executionService.enqueue(id);
  }

  /**
   * GET /api/jobs/:jobId — Get job status.
   * Returns the current state and progress of a BullMQ job.
   * Returns 404 if the job does not exist.
   */
  @Get('jobs/:jobId')
  async getJobStatus(@Param('jobId') jobId: string): Promise<JobStatusResponse> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Job with id "${jobId}" not found`);
    }

    const state = await job.getState();

    return {
      jobId: job.id!,
      state,
      progress: job.progress,
    };
  }

  /**
   * DELETE /api/cache — Clear the action cache.
   * Returns cache stats before clearing.
   */
  @Delete('cache')
  clearCache(): { message: string; cleared: number } {
    const stats = this.actionCacheService.getStats();
    this.actionCacheService.clearAll();
    return { message: 'Cache cleared', cleared: stats.size };
  }

  /**
   * GET /api/cache/stats — Get cache statistics.
   */
  @Get('cache/stats')
  getCacheStats(): { size: number; maxSize: number } {
    return this.actionCacheService.getStats();
  }

  /**
   * GET /api/auth — Get current auth configuration.
   */
  @Get('auth')
  getAuth(): any {
    const authPath = path.resolve(process.cwd(), 'data', 'auth.json');
    if (!fs.existsSync(authPath)) {
      return { configured: false, loginUrl: '', email: '', password: '', localStorage: {} };
    }
    try {
      const data = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
      return { configured: true, ...data };
    } catch {
      return { configured: false, loginUrl: '', email: '', password: '', localStorage: {} };
    }
  }

  /**
   * PUT /api/auth — Save auth configuration.
   * Supports two modes:
   * 1. Credentials mode: { loginUrl, email, password } — system logs in automatically
   * 2. Token mode: { localStorage: { key: value } } — injects tokens directly
   */
  @Put('auth')
  saveAuth(@Body() body: any): { message: string } {
    const authPath = path.resolve(process.cwd(), 'data', 'auth.json');
    const dir = path.dirname(authPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(authPath, JSON.stringify(body, null, 2), 'utf-8');
    return { message: 'Auth configuration saved' };
  }

  /**
   * DELETE /api/auth — Clear auth configuration.
   */
  @Delete('auth')
  clearAuth(): { message: string } {
    const authPath = path.resolve(process.cwd(), 'data', 'auth.json');
    if (fs.existsSync(authPath)) {
      fs.unlinkSync(authPath);
    }
    return { message: 'Auth configuration cleared' };
  }

  /**
   * GET /api/screenshots/:filename — Serve a screenshot image.
   */
  @Get('screenshots/:filename')
  getScreenshot(@Param('filename') filename: string, @Res() res: any): void {
    const filePath = path.resolve(process.cwd(), 'data', 'screenshots', filename);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Screenshot "${filename}" not found`);
    }
    res.sendFile(filePath);
  }
}
