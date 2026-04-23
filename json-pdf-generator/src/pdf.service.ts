import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as Handlebars from 'handlebars';
import puppeteer from 'puppeteer-core';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chromium = require('@sparticuz/chromium');
import { PdfDocumentDto, PdfGenerateRequestDto } from './dto';
import { GenerationResult, PdfGenerateResponse } from './interfaces';

// Handlebars helpers
Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
Handlebars.registerHelper('gridColumns', (columns: Array<{ width?: string }>) => {
  return columns.map(c => c.width ?? '1fr').join(' ');
});

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private readonly outputDir = path.join(process.cwd(), 'pdf');

  // Template directories — searched in order
  private readonly templateDirs = [
    path.join(__dirname, 'template'),                          // ts-node: src/template/
    path.join(__dirname, '..', 'template'),                    // compiled: dist/template/ (from dist/src/)
    path.join(__dirname, '..', 'src', 'template'),             // compiled alt: dist/src/template/
    path.join(__dirname, '..', '..', 'src', 'template'),       // compiled from dist/src/: ../../src/template/
    path.join(process.cwd(), 'src', 'template'),               // cwd fallback
    path.join(process.cwd(), 'dist', 'template'),              // cwd dist fallback
    path.join(process.cwd(), 'templates'),                     // custom templates at project root
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // New flexible API: template name + data + optional S3 output
  // ─────────────────────────────────────────────────────────────────────────
  async generate(req: PdfGenerateRequestDto): Promise<PdfGenerateResponse> {
    const templateSrc = this.loadTemplate(req.template);
    const template = Handlebars.compile(templateSrc);

    // Resolve any logoUrl in data to a data URI
    const data = await this.resolveDataImages(req.data);

    const html = template(data);
    const filename = this.buildFilename();
    const buffer = await this.renderHtmlToPdf(html, data);

    // Decide output: S3 or blob
    const wantsS3 = req.output?.s3Bucket?.trim();

    if (wantsS3) {
      const s3Url = await this.uploadToS3(
        buffer,
        filename,
        req.output!.s3Bucket!,
        req.output!.s3Folder,
      );
      return { filename, s3Url };
    }

    return { filename, blob: buffer.toString('base64') };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Legacy API (backward compatible) — uses "document" template
  // ─────────────────────────────────────────────────────────────────────────
  async generatePdf(doc: PdfDocumentDto): Promise<GenerationResult> {
    const templateSrc = this.loadTemplate('document');
    const template = Handlebars.compile(templateSrc);

    const docWithLogo = await this.resolveDataImages(doc as any);
    const html = template(docWithLogo);
    const filename = this.buildFilename();
    const buffer = await this.renderHtmlToPdf(html, doc as any);

    fs.mkdirSync(this.outputDir, { recursive: true });
    const filePath = path.join(this.outputDir, filename);
    fs.writeFileSync(filePath, buffer);

    return { buffer, filename, filePath };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Template resolution
  // ─────────────────────────────────────────────────────────────────────────
  private loadTemplate(name: string): string {
    for (const dir of this.templateDirs) {
      const filePath = path.join(dir, `${name}.hbs`);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
    }
    throw new BadRequestException(
      `Template "${name}" not found. Searched: ${this.templateDirs.map(d => path.join(d, `${name}.hbs`)).join(', ')}`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HTML → PDF via Puppeteer
  // ─────────────────────────────────────────────────────────────────────────
  private async renderHtmlToPdf(html: string, data: Record<string, any>): Promise<Buffer> {
    const browser = await this.launchBrowser();

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Layout config with defaults
      const layout = data?.layout ?? {};
      const headerHeight = layout.headerHeight ?? '20mm';
      const footerHeight = layout.footerHeight ?? '18mm';
      const bodyPaddingTop = layout.bodyPaddingTop ?? '0mm';
      const bodyPaddingBottom = layout.bodyPaddingBottom ?? '0mm';
      const marginLeft = layout.marginLeft ?? '15mm';
      const marginRight = layout.marginRight ?? '15mm';

      // Compute effective top/bottom margins
      // top = headerHeight + bodyPaddingTop, bottom = footerHeight + bodyPaddingBottom
      const topMargin = this.addCssValues(headerHeight, bodyPaddingTop);
      const bottomMargin = this.addCssValues(footerHeight, bodyPaddingBottom);

      // Footer template
      const footerText = data?.footer?.text ?? '';
      const footerTemplate = footerText
        ? `<div style="width:100%;font-size:9pt;color:#777;text-align:center;
                       border-top:1px solid #ddd;padding-top:5px;
                       font-family:Helvetica,Arial,sans-serif;">
             ${footerText}
           </div>`
        : '<span></span>';

      // Header template — only used when showOnAllPages is true
      const showHeaderOnAll = data?.header?.showOnAllPages === true;
      let headerTemplate = '<span></span>';

      if (showHeaderOnAll && data?.header) {
        const h = data.header;
        const logoPart = h.logoUrl
          ? `<img src="${h.logoUrl}" style="height:40px;margin-right:12px;" />`
          : '';
        const titlePart = h.title
          ? `<span style="font-size:14pt;font-weight:700;color:#111;">${h.title}</span>`
          : '';
        const descPart = h.description
          ? `<span style="font-size:9pt;color:#555;margin-left:8px;">${h.description}</span>`
          : '';

        headerTemplate = `
          <div style="width:100%;display:flex;align-items:center;padding:0 20px;
                      border-bottom:1px solid #ddd;padding-bottom:6px;
                      font-family:Helvetica,Arial,sans-serif;">
            ${logoPart}${titlePart}${descPart}
          </div>`;
      }

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate,
        footerTemplate,
        margin: {
          top: topMargin,
          bottom: bottomMargin,
          left: marginLeft,
          right: marginRight,
        },
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Add two CSS values (only supports same-unit mm or px, or % treated as-is)
  // Falls back to just using the first value if units don't match
  // ─────────────────────────────────────────────────────────────────────────
  private addCssValues(a: string, b: string): string {
    const parseVal = (v: string) => {
      const match = v.trim().match(/^([\d.]+)\s*(mm|px|%)?$/);
      if (!match) return null;
      return { num: parseFloat(match[1]), unit: match[2] ?? 'mm' };
    };

    const pa = parseVal(a);
    const pb = parseVal(b);

    if (!pa) return a;
    if (!pb || pb.num === 0) return a;
    if (pa.unit !== pb.unit) return a; // can't add different units

    return `${pa.num + pb.num}${pa.unit}`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Browser launch — @sparticuz/chromium on Lambda, local Chrome otherwise
  // ─────────────────────────────────────────────────────────────────────────
  private async launchBrowser() {
    const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

    if (isLambda) {
      const execPath = await chromium.executablePath();
      this.logger.log(`Lambda — launching @sparticuz/chromium: ${execPath}`);
      return puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport ?? { width: 1920, height: 1080 },
        executablePath: execPath,
        headless: chromium.headless ?? true,
      });
    }

    // Local dev — find system Chrome
    const localChrome = process.env.CHROME_PATH || this.findLocalChrome();
    if (!localChrome) {
      throw new Error(
        'No local Chrome found. Set CHROME_PATH env var or install Google Chrome.\n'
        + 'On Lambda this is handled automatically by @sparticuz/chromium.',
      );
    }

    this.logger.log(`Local — launching Chrome: ${localChrome}`);
    return puppeteer.launch({
      executablePath: localChrome,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  private findLocalChrome(): string | null {
    const candidates = [
      // Windows
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      // macOS
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      // Linux
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ];
    return candidates.find(p => fs.existsSync(p)) ?? null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // S3 upload
  // ─────────────────────────────────────────────────────────────────────────
  private async uploadToS3(
    buffer: Buffer,
    filename: string,
    bucket: string,
    folder?: string,
  ): Promise<string> {
    // Dynamic import so @aws-sdk/client-s3 is only required when S3 output is used
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({});

    const key = folder?.trim()
      ? `${folder.replace(/\/+$/, '')}/${filename}`
      : filename;

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'application/pdf',
    }));

    // Return the public HTTPS URL (works when bucket has public read policy)
    const region = await s3.config.region();
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────
  private buildFilename(): string {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    return `${timestamp}-${uuidv4()}.pdf`;
  }

  private async resolveDataImages(data: Record<string, any>): Promise<Record<string, any>> {
    if (!data?.header?.logoUrl) return data;

    const logoUrl = data.header.logoUrl;
    let dataUri: string | null = null;

    try {
      const localPath = path.isAbsolute(logoUrl)
        ? logoUrl
        : path.join(process.cwd(), logoUrl);

      if (fs.existsSync(localPath)) {
        const buf = fs.readFileSync(localPath);
        const ext = path.extname(localPath).slice(1).toLowerCase();
        const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        dataUri = `data:${mime};base64,${buf.toString('base64')}`;
      } else if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) {
        dataUri = logoUrl;
      }
    } catch {
      this.logger.warn(`Could not resolve logo: ${logoUrl} — skipping`);
    }

    return {
      ...data,
      header: {
        ...data.header,
        logoUrl: dataUri ?? undefined,
      },
    };
  }
}
