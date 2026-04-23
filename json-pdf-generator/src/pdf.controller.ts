import { Controller, Post, Body, Res } from '@nestjs/common';
import { Response } from 'express';
import { PdfService } from './pdf.service';
import { PdfDocumentDto, PdfGenerateRequestDto } from './dto';

@Controller('pdf')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  /**
   * New flexible endpoint — template name + data + optional S3 output.
   *
   * POST /pdf/render
   * Body: { template: "invoice", data: { ... }, output?: { s3Bucket, s3Folder } }
   *
   * Returns JSON:
   *   - blob mode:  { filename, blob: "<base64>" }
   *   - S3 mode:    { filename, s3Url: "s3://bucket/folder/file.pdf" }
   */
  @Post('render')
  async render(@Body() body: PdfGenerateRequestDto) {
    return this.pdfService.generate(body);
  }

  /**
   * Legacy endpoint — backward compatible.
   * Accepts PdfDocumentDto, returns binary PDF.
   */
  @Post('generate')
  async generate(
    @Body() body: PdfDocumentDto,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.pdfService.generatePdf(body);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    res.send(buffer);
  }
}
