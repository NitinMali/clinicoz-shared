/**
 * Example 3: Inject PdfService into your own NestJS service
 *
 * PdfModule exports PdfService, so you can inject it anywhere
 * in your application after importing PdfModule.
 */

import { Injectable } from '@nestjs/common';
import { PdfService } from '../src/pdf.service';
import { PdfDocument } from '../src/interfaces';

@Injectable()
export class ReportService {
  constructor(private readonly pdfService: PdfService) {}

  async generateMonthlyReport(data: {
    month: string;
    revenue: string;
    costs: string;
  }) {
    const doc: PdfDocument = {
      header: {
        title: `Monthly Report — ${data.month}`,
        description: 'Auto-generated financial summary',
      },
      body: [
        {
          title: 'Summary',
          content: [
            {
              type: 'table',
              headers: ['Item', 'Amount'],
              rows: [
                ['Revenue', data.revenue],
                ['Costs', data.costs],
              ],
            },
          ],
        },
      ],
      footer: { text: `Generated on ${new Date().toDateString()}` },
    };

    return this.pdfService.generatePdf(doc as any);
  }
}

/**
 * Wire it up in your module:
 *
 * @Module({
 *   imports: [PdfModule],          // <-- import PdfModule
 *   providers: [ReportService],    // <-- your service gets PdfService injected
 * })
 * export class ReportsModule {}
 */
