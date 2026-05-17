import 'reflect-metadata';
import { PdfService } from '../src/pdf.service';

const service = new PdfService();

export const handler = async (event: any) => {
  try {
    const body = typeof event.body === 'string'
      ? JSON.parse(event.body)
      : event;

    const result = await service.generate(body);

    if (result.s3Url) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: result.filename, s3Url: result.s3Url }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
      body: result.blob,
      isBase64Encoded: true,
    };
  } catch (err: any) {
    console.error('PDF generation failed:', err);
    return {
      statusCode: err.status || 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Internal server error' }),
    };
  }
};
