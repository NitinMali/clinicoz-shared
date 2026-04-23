/**
 * Example 2: Full NestJS application — import PdfModule into your app
 *
 * This shows how to wire PdfModule into an existing NestJS v9 app.
 * The POST /pdf/generate endpoint becomes available automatically.
 *
 * Run:
 *   npx ts-node examples/2-nestjs-app.ts
 *
 * Then test with curl:
 *   curl -X POST http://localhost:3000/pdf/generate \
 *     -H "Content-Type: application/json" \
 *     -d @examples/payload.json \
 *     --output output.pdf
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { PdfModule } from '../src/pdf.module';

@Module({ imports: [PdfModule] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Required: enables DTO validation (400 on bad input)
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  await app.listen(3000);
  console.log('Server running at http://localhost:3000');
  console.log('POST http://localhost:3000/pdf/generate');
}

bootstrap().catch(console.error);
