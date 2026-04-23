import { NestFactory } from '@nestjs/core';
import { PdfModule } from './pdf.module';

async function bootstrap() {
  const app = await NestFactory.create(PdfModule);
  const port = process.env.PORT || 8181;
  await app.listen(port);
  console.log(`PDF Generator running on http://localhost:${port}`);
}

bootstrap();
