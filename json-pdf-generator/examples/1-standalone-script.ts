/**
 * Example 1: Standalone script — generate a PDF without NestJS
 *
 * Run:
 *   npx ts-node examples/1-standalone-script.ts
 */

import 'reflect-metadata';
import { PdfService } from '../src/pdf.service';
import { MOCK_PDF_DOCUMENT } from '../src/mock-data';

async function main() {
  const service = new PdfService();

  console.log('Generating PDF...');
  const result = await service.generatePdf(MOCK_PDF_DOCUMENT as any);

  console.log('Done!');
  console.log('  filename :', result.filename);
  console.log('  filePath :', result.filePath);
  console.log('  size     :', result.buffer.length, 'bytes');
}

main().catch(console.error);
