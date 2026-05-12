import { Controller, Post, Body } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { PdfGenerateRequestDto } from './dto';

@Controller('pdf')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  /**
   * POST /pdf/render
   * Body: { template: "document", data: { ... }, output?: { s3Bucket, s3Folder } }
   *
   * Returns JSON:
   *   - blob mode:  { filename, blob: "<base64>" }
   *   - S3 mode:    { filename, s3Url: "https://bucket.s3.region.amazonaws.com/..." }
   */
  @Post('render')
  async render(@Body() body: PdfGenerateRequestDto) {
    return this.pdfService.generate(body);
  }
}
