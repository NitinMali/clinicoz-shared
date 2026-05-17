import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as Handlebars from 'handlebars';
import puppeteer from 'puppeteer-core';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chromium = require('@sparticuz/chromium');
import { PdfGenerateRequestDto } from './dto';
import { PdfGenerateResponse } from './interfaces';

// Handlebars helpers
Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
Handlebars.registerHelper('gridColumns', (columns: Array<{ width?: string }>) => {
  return columns.map(c => c.width ?? '1fr').join(' ');
});
// Extract text from a rich item (string or { text, style })
Handlebars.registerHelper('cellText', (item: unknown) => {
  if (typeof item === 'string') return new Handlebars.SafeString(item.replace(/\n/g, '<br>'));
  if (item && typeof item === 'object' && 'text' in item) {
    return new Handlebars.SafeString(((item as any).text || '').replace(/\n/g, '<br>'));
  }
  return '';
});
// Extract style from a rich item (string or { text, style })
Handlebars.registerHelper('cellStyle', (item: unknown) => {
  if (item && typeof item === 'object' && 'style' in item) return (item as any).style || '';
  return '';
});
// Convert \n to <br> for multiline text
Handlebars.registerHelper('nl2br', (text: unknown) => {
  if (typeof text !== 'string') return text;
  return new Handlebars.SafeString(
    Handlebars.Utils.escapeExpression(text).replace(/\n/g, '<br>')
  );
});

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

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
      const footerHeight = layout.footerHeight ?? '18mm';
      const bodyPaddingTop = layout.bodyPaddingTop ?? '0mm';
      const bodyPaddingBottom = layout.bodyPaddingBottom ?? '0mm';
      const marginLeft = layout.marginLeft ?? '15mm';
      const marginRight = layout.marginRight ?? '15mm';

      // If header has imageUrl and NOT showOnAllPages, use 0 top margin so the image starts at the page top
      // The image is part of the HTML body content and handles its own spacing
      const hasHeaderImage = !!data?.header?.imageUrl;
      const showHeaderOnAll = data?.header?.showOnAllPages === true;
      const headerImageInBody = hasHeaderImage && !showHeaderOnAll;
      const headerImageInTemplate = hasHeaderImage && showHeaderOnAll;
      const headerHeight = headerImageInBody ? '0mm' : (layout.headerHeight ?? '20mm');

      // Compute effective top/bottom margins
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

      // Header template — used when showOnAllPages is true
      const showLogoHeaderOnAll = showHeaderOnAll && !hasHeaderImage;
      let headerTemplate = '<span></span>';
      let displayHeaderFooter = true;

      if (headerImageInTemplate && data?.header?.imageUrl) {
        // Full-width image header on every page
        headerTemplate = `<img src="${data.header.imageUrl}" style="${edgeImageStyle}" />`;
      } else if (showLogoHeaderOnAll && data?.header) {
        const h = data.header;
        const logoStyle = h.logoStyle || 'height:40px;';
        const logoPart = h.logoUrl
          ? `<img src="${h.logoUrl}" style="${logoStyle}" />`
          : '';
        const titlePart = h.title
          ? `<span style="font-size:14pt;font-weight:700;color:#111;">${h.title}</span>`
          : '';
        const descPart = h.description
          ? `<span style="font-size:9pt;color:#555;">${h.description.replace(/\n/g, '<br/>')}</span>`
          : '';

        if (logoPart || titlePart || descPart) {
          headerTemplate = `
            <table style="width:100%;border-collapse:collapse;border-bottom:1px solid #ddd;font-family:Helvetica,Arial,sans-serif;">
              <tr>
                <td style="padding:8px 0 8px 20px;width:1%;white-space:nowrap;">${logoPart}</td>
                <td style="padding:8px 20px 8px 12px;width:99%;">${titlePart}${descPart ? '<br/>' + descPart : ''}</td>
              </tr>
            </table>`;
        } else {
          displayHeaderFooter = false;
        }
      }

      // Use CDP directly — Puppeteer's page.pdf() has a bug in v24+ with Chrome 148+
      // where images are not embedded in the PDF output
      const client = await page.createCDPSession();
      const cdpResult = await client.send('Page.printToPDF', {
        landscape: false,
        displayHeaderFooter: !!(footerText || headerImageInTemplate || showLogoHeaderOnAll),
        headerTemplate,
        footerTemplate,
        printBackground: true,
        paperWidth: 8.27,  // A4 in inches
        paperHeight: 11.69,
        marginTop: this.mmToInches(topMargin),
        marginBottom: this.mmToInches(bottomMargin),
        marginLeft: this.mmToInches(marginLeft),
        marginRight: this.mmToInches(marginRight),
        preferCSSPageSize: false,
        generateTaggedPDF: false,
        transferMode: 'ReturnAsBase64',
      });

      return Buffer.from(cdpResult.data, 'base64');
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

  // Convert CSS mm/px value to inches for CDP Page.printToPDF
  private mmToInches(value: string): number {
    const match = value.trim().match(/^([\d.]+)\s*(mm|px|in)?$/);
    if (!match) return 0.78; // default ~20mm
    const num = parseFloat(match[1]);
    const unit = match[2] ?? 'mm';
    switch (unit) {
      case 'mm': return num / 25.4;
      case 'px': return num / 96;
      case 'in': return num;
      default: return num / 25.4;
    }
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
    const result = { ...data };
    if (data.header) result.header = { ...data.header };
    if (data.footer) result.footer = { ...data.footer };

    // Resolve header logoUrl
    if (result.header?.logoUrl) {
      result.header.logoUrl = await this.resolveImagePath(result.header.logoUrl) ?? undefined;
    }

    // Resolve header imageUrl (full-width)
    if (result.header?.imageUrl) {
      const resolved = await this.resolveImageToBuffer(result.header.imageUrl);
      if (resolved) {
        result.header.imageUrl = resolved.dataUri;
        // Auto-calculate headerHeight based on image aspect ratio
        const dims = this.getImageDimensions(resolved.buffer);
        if (dims) {
          // When showOnAllPages, image goes in Puppeteer headerTemplate spanning full page width (210mm)
          // When not showOnAllPages, image is in HTML body within margins
          const pageWidth = result.header.showOnAllPages ? 210 : 180; // A4 mm (full or within 15mm margins)
          const computedHeight = (pageWidth * dims.height) / dims.width;
          const clamped = Math.max(15, Math.min(120, computedHeight));
          if (!result.layout) result.layout = {};
          // Auto-set headerHeight if user hasn't explicitly provided one
          if (result.header.showOnAllPages && !data.layout?.headerHeight) {
            result.layout.headerHeight = `${Math.ceil(clamped + 10)}mm`; // +2mm padding
          }
          result._headerImageHeight = clamped;
        }
      } else {
        result.header.imageUrl = undefined;
      }
    }

    // Resolve footer imageUrl if present
    if (result.footer?.imageUrl) {
      result.footer.imageUrl = await this.resolveImagePath(result.footer.imageUrl) ?? undefined;
    }

    // Resolve image items in body content
    if (result.body && Array.isArray(result.body)) {
      result.body = await this.resolveBodyImages(result.body);
    }

    return result;
  }

  /** Recursively resolve image src in body content items */
  private async resolveBodyImages(body: any[]): Promise<any[]> {
    const resolved = [];
    for (const section of body) {
      const s = { ...section };
      if (s.content && Array.isArray(s.content)) {
        s.content = await this.resolveContentImages(s.content);
      }
      resolved.push(s);
    }
    return resolved;
  }

  private async resolveContentImages(content: any[]): Promise<any[]> {
    const resolved = [];
    for (const item of content) {
      if (item.type === 'image' && item.src) {
        const dataUri = await this.resolveImagePath(item.src);
        resolved.push({ ...item, src: dataUri ?? item.src });
      } else if (item.type === 'grid' && item.columns) {
        // Resolve images inside grid columns
        const cols = [];
        for (const col of item.columns) {
          if (col.content && Array.isArray(col.content)) {
            cols.push({ ...col, content: await this.resolveContentImages(col.content) });
          } else {
            cols.push(col);
          }
        }
        resolved.push({ ...item, columns: cols });
      } else {
        resolved.push(item);
      }
    }
    return resolved;
  }

  /** Resolve an image URL to a data URI string */
  private async resolveImagePath(url: string): Promise<string | null> {
    const result = await this.resolveImageToBuffer(url);
    return result?.dataUri ?? null;
  }

  /** Resolve an image URL to both a data URI and raw buffer */
  private async resolveImageToBuffer(url: string): Promise<{ dataUri: string; buffer: Buffer } | null> {
    try {
      if (url.startsWith('data:')) {
        // Extract buffer from data URI
        const match = url.match(/^data:[^;]+;base64,(.+)$/);
        if (match) {
          return { dataUri: url, buffer: Buffer.from(match[1], 'base64') };
        }
        return null;
      }

      if (url.startsWith('http://') || url.startsWith('https://')) {
        const buffer = await this.fetchImageBuffer(url);
        if (buffer) {
          const contentType = this.guessContentType(url);
          const dataUri = `data:${contentType};base64,${buffer.toString('base64')}`;
          return { dataUri, buffer };
        }
        return null;
      }

      // Local file
      const localPath = path.isAbsolute(url) ? url : path.join(process.cwd(), url);
      if (fs.existsSync(localPath)) {
        const buffer = fs.readFileSync(localPath);
        const ext = path.extname(localPath).slice(1).toLowerCase();
        const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
        return { dataUri, buffer };
      }
    } catch {
      this.logger.warn(`Could not resolve image: ${url} — skipping`);
    }
    return null;
  }

  /** Fetch a remote image and return the raw buffer */
  private async fetchImageBuffer(url: string): Promise<Buffer | null> {
    try {
      // Use global fetch (available in Node 18+)
      const res = await fetch(url);
      if (!res.ok) {
        this.logger.warn(`Image fetch failed (${res.status}): ${url}`);
        return null;
      }
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (err: any) {
      this.logger.warn(`Failed to fetch image: ${url} — ${err?.message || err}`);
      return null;
    }
  }

  /** Guess content type from URL extension */
  private guessContentType(url: string): string {
    const ext = path.extname(new URL(url).pathname).slice(1).toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'svg') return 'image/svg+xml';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    return 'image/png';
  }

  /** Extract width/height from PNG or JPEG buffer */
  private getImageDimensions(buf: Buffer): { width: number; height: number } | null {
    try {
      // PNG: width at offset 16, height at offset 20 (4 bytes each, big-endian)
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        return { width, height };
      }
      // JPEG: scan for SOF0 marker (0xFF 0xC0) or SOF2 (0xFF 0xC2)
      if (buf[0] === 0xFF && buf[1] === 0xD8) {
        let offset = 2;
        while (offset < buf.length - 8) {
          if (buf[offset] !== 0xFF) { offset++; continue; }
          const marker = buf[offset + 1];
          if (marker === 0xC0 || marker === 0xC2) {
            const height = buf.readUInt16BE(offset + 5);
            const width = buf.readUInt16BE(offset + 7);
            return { width, height };
          }
          const segLen = buf.readUInt16BE(offset + 2);
          offset += 2 + segLen;
        }
      }
    } catch { /* ignore */ }
    return null;
  }
}
