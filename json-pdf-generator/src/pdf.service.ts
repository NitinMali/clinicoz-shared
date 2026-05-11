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
      const footerImageUrl = data?.footer?.imageUrl ?? '';
      // Parse margin values to compute negative offsets for edge-to-edge images
      const parseMm = (v: string) => {
        const m = v.trim().match(/^([\d.]+)\s*mm$/);
        return m ? parseFloat(m[1]) : 0;
      };
      const mLeft = parseMm(marginLeft);
      const mRight = parseMm(marginRight);
      // Negative top margin compensates for Puppeteer header iframe's default body margin
      const edgeImageStyle = `display:block;width:calc(100% + ${mLeft + mRight}mm);height:auto;margin:-5mm -${mRight}mm 0 -${mLeft}mm;padding:0;vertical-align:top;border:none;`;
      const footerTemplate = footerImageUrl
        ? `<img src="${footerImageUrl}" style="${edgeImageStyle}" />`
        : footerText
        ? `<div style="width:100%;font-size:9pt;color:#777;text-align:center;
                       border-top:1px solid #ddd;padding-top:5px;
                       font-family:Helvetica,Arial,sans-serif;">
             ${footerText}
           </div>`
        : '<span></span>';

      // Header template — only used when showOnAllPages is true
      const showHeaderOnAll = data?.header?.showOnAllPages === true;
      let headerTemplate = '<span></span>';
      let displayHeaderFooter = true;

      if (showHeaderOnAll && data?.header) {
        const h = data.header;

        // If headerImageUrl exists, use it as entire header (edge-to-edge)
        if (h.imageUrl) {
          headerTemplate = `<img src="${h.imageUrl}" style="${edgeImageStyle}" />`;
        } else {
          const logoPart = h.logoUrl
            ? `<img src="${h.logoUrl}" style="height:40px;" />`
            : '';
          const titlePart = h.title
            ? `<span style="font-size:14pt;font-weight:700;color:#111;">${h.title}</span>`
            : '';
          const descPart = h.description
            ? `<span style="font-size:9pt;color:#555;">${h.description.replace(/\n/g, '<br/>')}</span>`
            : '';

          // Only build header template if there's actual content
          if (logoPart || titlePart || descPart) {
            headerTemplate = `
              <table style="width:100%;border-collapse:collapse;border-bottom:1px solid #ddd;font-family:Helvetica,Arial,sans-serif;">
                <tr>
                  <td style="padding:8px 0 8px 20px;width:1%;white-space:nowrap;">${logoPart}</td>
                  <td style="padding:8px 20px 8px 12px;width:99%;">${titlePart}${descPart ? '<br/>' + descPart : ''}</td>
                </tr>
              </table>`;
          } else {
            // No header content, disable header
            displayHeaderFooter = false;
          }
        }
      }

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter,
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

  // Parse image dimensions from buffer (PNG/JPEG) without external deps
  private getImageDimensions(buf: Buffer): { width: number; height: number } | null {
    try {
      // PNG: signature 89 50 4E 47 0D 0A 1A 0A, then IHDR with W/H at bytes 16-23
      if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        return { width, height };
      }
      // JPEG: starts with FF D8, scan for SOF markers (C0-CF, excl. C4, C8, CC)
      if (buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
        let i = 2;
        while (i < buf.length - 9) {
          if (buf[i] !== 0xFF) { i++; continue; }
          const marker = buf[i + 1];
          // skip padding 0xFF bytes
          if (marker === 0xFF) { i++; continue; }
          // SOI/EOI have no length
          if (marker === 0xD8 || marker === 0xD9) { i += 2; continue; }
          // SOF markers
          if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
            const height = buf.readUInt16BE(i + 5);
            const width = buf.readUInt16BE(i + 7);
            return { width, height };
          }
          // skip segment
          const segLen = buf.readUInt16BE(i + 2);
          i += 2 + segLen;
        }
      }
    } catch {}
    return null;
  }

  private async resolveDataImages(data: Record<string, any>): Promise<Record<string, any>> {
    const urlsToResolve: { url: string; keyPath: string[] }[] = [];

    // Collect logoUrl
    if (data?.header?.logoUrl) {
      urlsToResolve.push({ url: data.header.logoUrl, keyPath: ['header', 'logoUrl'] });
    }

    // Collect headerImageUrl
    if (data?.header?.imageUrl) {
      urlsToResolve.push({ url: data.header.imageUrl, keyPath: ['header', 'imageUrl'] });
    }

    // Collect footerImageUrl
    if (data?.footer?.imageUrl) {
      urlsToResolve.push({ url: data.footer.imageUrl, keyPath: ['footer', 'imageUrl'] });
    }

    if (urlsToResolve.length === 0) return data;

    const result = { ...data };

    for (const { url, keyPath } of urlsToResolve) {
      let dataUri: string | null = null;
      let imageBuf: Buffer | null = null;

      try {
        const localPath = path.isAbsolute(url)
          ? url
          : path.join(process.cwd(), url);

        if (fs.existsSync(localPath)) {
          const buf = fs.readFileSync(localPath);
          imageBuf = buf;
          const ext = path.extname(localPath).slice(1).toLowerCase();
          const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          dataUri = `data:${mime};base64,${buf.toString('base64')}`;
        } else if (url.startsWith('http://') || url.startsWith('https://')) {
          // Fetch remote image and convert to data URI — Puppeteer header
          // template cannot reliably load external network resources.
          const res = await fetch(url);
          if (res.ok) {
            const arrayBuf = await res.arrayBuffer();
            const buf = Buffer.from(arrayBuf);
            imageBuf = buf;
            const contentType = res.headers.get('content-type') || 'image/png';
            dataUri = `data:${contentType};base64,${buf.toString('base64')}`;
          } else {
            this.logger.warn(`Image fetch failed (${res.status}): ${url}`);
          }
        }
      } catch (err) {
        this.logger.warn(`Could not resolve image: ${url} — ${err?.message || err}`);
      }

      // Set the data URI in the result
      let current = result;
      for (let i = 0; i < keyPath.length - 1; i++) {
        current = current[keyPath[i]];
      }
      current[keyPath[keyPath.length - 1]] = dataUri ?? undefined;

      // Extract image dimensions for header/footer images to dynamically size them
      if (imageBuf && (keyPath.join('.') === 'header.imageUrl' || keyPath.join('.') === 'footer.imageUrl')) {
        const dims = this.getImageDimensions(imageBuf);
        if (dims) {
          // A4 width = 210mm, minus left+right margins (default 15mm each) = 180mm content width
          // headerHeight = contentWidth / aspectRatio
          const layout = result.layout || {};
          const parseMm = (v: string) => {
            const m = String(v).trim().match(/^([\d.]+)\s*mm$/);
            return m ? parseFloat(m[1]) : 0;
          };
          const mLeft = parseMm(layout.marginLeft || '15mm') || 15;
          const mRight = parseMm(layout.marginRight || '15mm') || 15;
          // Image spans full page width (210mm), not just content width, due to negative margins
          const fullPageWidth = 210; // A4 width in mm
          const computedHeight = (fullPageWidth * dims.height) / dims.width;
          // Clamp to safe range
          const clamped = Math.max(15, Math.min(120, computedHeight));

          if (!result.layout) result.layout = {};
          if (keyPath[0] === 'header') {
            result.layout.headerHeight = `${clamped}mm`;
          } else {
            result.layout.footerHeight = `${clamped}mm`;
          }
        }
      }
    }

    return result;
  }
}
