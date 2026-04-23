# json-to-pdf-generator

A NestJS v9 package that converts structured JSON into formatted PDF documents. Uses **Handlebars** for HTML templating and **Puppeteer** for PDF rendering — no coordinate math, full CSS layout control.

---

## Installation

```bash
npm install
```

Puppeteer downloads Chromium (~170MB) on first install. This is a one-time download.

---

## Quick Start

### Standalone script (no NestJS required)

```ts
import 'reflect-metadata';
import { PdfService } from './src/pdf.service';
import { MOCK_PDF_DOCUMENT } from './src/mock-data';

const service = new PdfService();
const result = await service.generatePdf(MOCK_PDF_DOCUMENT as any);

console.log(result.filePath);  // absolute path to saved PDF
console.log(result.filename);  // e.g. 2024-01-15T10-30-00-000Z-<uuid>.pdf
console.log(result.buffer);    // Buffer of PDF bytes
```

```bash
npx ts-node examples/1-standalone-script.ts
```

### NestJS application

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { PdfModule } from './src/pdf.module';

@Module({ imports: [PdfModule] })
export class AppModule {}
```

```ts
// main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

const app = await NestFactory.create(AppModule);
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
await app.listen(3000);
```

Then POST to the endpoint:

```bash
curl -X POST http://localhost:3000/pdf/generate \
  -H "Content-Type: application/json" \
  -d @examples/payload.json \
  --output output.pdf
```

### Inject PdfService into your own service

```ts
import { Injectable } from '@nestjs/common';
import { PdfService } from 'json-to-pdf-generator';

@Injectable()
export class ReportService {
  constructor(private readonly pdf: PdfService) {}

  async buildReport() {
    return this.pdf.generatePdf({ body: [ /* ... */ ] });
  }
}
```

```ts
// your.module.ts
@Module({
  imports: [PdfModule],       // exports PdfService automatically
  providers: [ReportService],
})
export class YourModule {}
```

---

## HTTP API

### `POST /pdf/generate`

**Request body:** `PdfDocumentDto` (JSON)

**Success response:** Binary PDF file
- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="<generated>.pdf"`

**Error responses:**
- `400` — validation failure (missing/invalid fields)
- `500` — internal generation error

---

## Document Structure

```ts
interface PdfDocument {
  header?: PdfHeader;      // optional
  body:    PdfSection[];   // required, min 1 section
  footer?: PdfFooter;      // optional — appears on every page
}
```

### Header

```ts
interface PdfHeader {
  logoUrl?:     string;  // local path (e.g. "src/img/logo.png") or https:// URL
  title?:       string;
  description?: string;
}
```

Logo and title/description render on the same line. Logo is resolved from disk first, then falls back to remote URL.

```json
"header": {
  "logoUrl": "src/img/logo.png",
  "title": "Quarterly Report",
  "description": "Q1 2024 — Internal Use Only"
}
```

### Footer

```ts
interface PdfFooter {
  text: string;  // rendered at the bottom of every page
}
```

```json
"footer": {
  "text": "© 2024 Acme Corp. Confidential."
}
```

### Section

```ts
interface PdfSection {
  title:   string;        // rendered as a heading
  content: ContentItem[]; // min 1 item
}
```

---

## Content Types

### `paragraph`

```json
{
  "type": "paragraph",
  "text": "Your text here.",
  "align": "justify"
}
```

| Field   | Type                                      | Default  |
|---------|-------------------------------------------|----------|
| `text`  | `string`                                  | required |
| `align` | `"left" \| "center" \| "right" \| "justify"` | `"left"` |

---

### `bulletList`

```json
{
  "type": "bulletList",
  "items": ["First item", "Second item", "Third item"]
}
```

---

### `table`

```json
{
  "type": "table",
  "headers": ["Name", "Role", "Department", "Location", "Start Date"],
  "rows": [
    ["Alice Johnson", "Engineer", "Platform", "London", "2021-03-01"],
    ["Bob Martinez",  "Designer", "Product",  "Berlin", "2022-07-15"]
  ]
}
```

Tables use `table-layout: fixed` with `font-size: 8.5pt` to fit wide columns on A4.

---

### `grid`

Renders content in a multi-column CSS grid. Each column can have its own width, alignment, and any mix of content items.

```ts
interface GridItem {
  type:     'grid';
  columns:  GridColumn[];
  gap?:     string;        // CSS gap value, default "12px"
}

interface GridColumn {
  width?:   string;        // CSS value e.g. "40%", "1fr", "200px"
  align?:   'left' | 'center' | 'right';
  content:  (ParagraphItem | TableItem | BulletListItem)[];
}
```

#### 2-column equal

```json
{
  "type": "grid",
  "columns": [
    {
      "content": [
        { "type": "paragraph", "text": "Left column content." }
      ]
    },
    {
      "content": [
        { "type": "paragraph", "text": "Right column content." }
      ]
    }
  ]
}
```

#### 3-column centered stats

```json
{
  "type": "grid",
  "gap": "16px",
  "columns": [
    { "content": [{ "type": "paragraph", "text": "$48.6M", "align": "center" }] },
    { "content": [{ "type": "paragraph", "text": "1,240",  "align": "center" }] },
    { "content": [{ "type": "paragraph", "text": "93.8%",  "align": "center" }] }
  ]
}
```

#### 2-column label / value (invoice style)

```json
{
  "type": "grid",
  "gap": "8px",
  "columns": [
    {
      "width": "40%",
      "content": [
        { "type": "paragraph", "text": "Invoice Number:", "align": "left" },
        { "type": "paragraph", "text": "Due Date:",       "align": "left" }
      ]
    },
    {
      "width": "60%",
      "content": [
        { "type": "paragraph", "text": "INV-2024-00842", "align": "right" },
        { "type": "paragraph", "text": "30 April 2024",  "align": "right" }
      ]
    }
  ]
}
```

#### 2-column wide content + sidebar

```json
{
  "type": "grid",
  "gap": "20px",
  "columns": [
    {
      "width": "65%",
      "content": [
        { "type": "paragraph", "text": "Main content area.", "align": "justify" },
        {
          "type": "table",
          "headers": ["Item", "Qty", "Total"],
          "rows": [["License", "5", "$6,000"]]
        }
      ]
    },
    {
      "width": "35%",
      "content": [
        { "type": "paragraph", "text": "Sidebar notes." },
        { "type": "bulletList", "items": ["Net 30", "Wire transfer only"] }
      ]
    }
  ]
}
```

---

## Output

Generated PDFs are saved to `pdf/` relative to `process.cwd()`. The directory is created automatically if it doesn't exist.

```ts
interface GenerationResult {
  buffer:   Buffer;  // in-memory PDF bytes (use for HTTP response)
  filename: string;  // e.g. "2024-01-15T10-30-00-000Z-<uuid>.pdf"
  filePath: string;  // absolute path to saved file
}
```

Filenames are collision-safe: `<ISO-timestamp>-<UUIDv4>.pdf`.

---

## Logo Resolution

`logoUrl` is resolved in this order:

1. **Relative local path** — resolved from `process.cwd()` (e.g. `"src/img/logo.png"`)
2. **Absolute local path** — used as-is
3. **Remote URL** — `http://` or `https://` passed directly to Puppeteer
4. **Not found** — warning logged, logo skipped, generation continues

---

## Customising the Template

The HTML template lives at `src/template/document.hbs`. It's a standard Handlebars template — edit the CSS or HTML structure to match your brand.

Handlebars helpers available:
- `{{eq a b}}` — equality check for `{{#if (eq type "paragraph")}}`
- `{{gridColumns columns}}` — builds `grid-template-columns` CSS from column widths

---

## Project Structure

```
src/
├── template/
│   └── document.hbs      # Handlebars HTML template
├── dto/
│   └── index.ts          # class-validator DTOs
├── interfaces/
│   └── index.ts          # TypeScript interfaces
├── pdf.service.ts         # Core generation logic
├── pdf.controller.ts      # POST /pdf/generate endpoint
├── pdf.module.ts          # NestJS module
├── mock-data.ts           # Ready-made test payload
└── index.ts               # Barrel export

examples/
├── 1-standalone-script.ts # Run without NestJS
├── 2-nestjs-app.ts        # Full NestJS app bootstrap
├── 3-inject-service.ts    # Inject PdfService into your service
└── payload.json           # Sample JSON payload for curl/Postman
```

---

## Running Examples

```bash
# Standalone — generates pdf/<timestamp>.pdf
npx ts-node examples/1-standalone-script.ts

# NestJS server — then POST to http://localhost:3000/pdf/generate
npx ts-node examples/2-nestjs-app.ts

# curl with payload.json
curl -X POST http://localhost:3000/pdf/generate \
  -H "Content-Type: application/json" \
  -d @examples/payload.json \
  --output output.pdf
```

---

## Build

```bash
npm run build   # compiles to dist/
```

> **Note:** Copy `src/template/document.hbs` to `dist/template/` after building, or configure your bundler to include `.hbs` files.

```bash
# Quick copy after build
cp -r src/template dist/template
```
