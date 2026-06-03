import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load .env file if it exists (local dev). In Docker, env vars are injected via docker-compose env_file.
const envPath = path.resolve(__dirname, '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else if (!process.env.NODE_ENV) {
  // No .env file AND no env vars set — fail only in this case
  console.error(
    `[FATAL] Configuration file not found: ${envPath}\n` +
      `Please create a .env file or provide environment variables via Docker.\n` +
      `See .env.example for the expected format.`,
  );
  process.exit(1);
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { HttpExceptionFilter } from './src/common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Register global exception filter for consistent error responses (Requirement 9.4, 9.6)
  app.useGlobalFilters(new HttpExceptionFilter());

  // Bind to configured PORT. Use 0.0.0.0 to allow external access (Docker/EC2).
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = '0.0.0.0';

  await app.listen(port, host);
  console.log(`[e2e-testing] Server running on http://${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error('[FATAL] Failed to start application:', err);
  process.exit(1);
});
