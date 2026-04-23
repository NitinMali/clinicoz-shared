# Usage Guide — json-to-pdf-generator

Complete reference for all features, options, and content types.

---

## Two APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /pdf/render` | New flexible API | Pass template name + data JSON + optional S3 output |
| `POST /pdf/generate` | Legacy API | Pass a `PdfDocumentDto` directly, get binary PDF back |

---

## New API: `POST /pdf/render`

### Minimal request (blob response)

```json
{
  "template": "document",
  "data": {
    "body": [
      {
        "title": "Hello",
        "content": [
          { "type": "paragraph", "text": "This is a PDF." }
        ]
      }
    ]
  }
}
```

Response:
```json
{
  "filename": "2024-01-15T10-30-00-000Z-<uuid>.pdf",
  "blob": "<base64-encoded PDF>"
}
```

### With S3 output

```json
{
  "template": "document",
  "data": { ... },
  "output": {
    "s3Bucket": "my-pdf-bucket",
    "s3Folder": "reports/2024"
  }
}
```

Response:
```json
{
  "filename": "2024-01-15T10-30-00-000Z-<uuid>.pdf",
  "s3Url": "s3://my-pdf-bucket/reports/2024/2024-01-15T10-30-00-000Z-<uuid>.pdf"
}
```

If `s3Bucket` is blank or `output` is omitted → blob is returned.

### Request fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `template` | string | Yes | Template name without `.hbs` extension |
| `data` | object | Yes | Any JSON — passed to the Handlebars template |
| `output` | object | No | S3 output config |
| `output.s3Bucket` | string | No | S3 bucket name |
| `output.s3Folder` | string | No | S3 folder/prefix (no trailing slash) |

---

## Legacy API: `POST /pdf/generate`

Returns binary PDF with headers:
- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="<name>.pdf"`

---

## Header

```json
"header": {
  "logoUrl": "src/img/logo.png",
  "title": "Monthly Report",
  "description": "Generated on 2024-04-01",
  "showOnAllPages": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `logoUrl` | string | — | Local file path or `https://` URL |
| `title` | string | — | Header title text |
| `description` | string | — | Subtitle / description |
| `showOnAllPages` | boolean | `false` | `true` = header on every page, `false` = first page only |

### Logo resolution order

1. Relative local path → resolved from `process.cwd()` (e.g. `"src/img/logo.png"`)
2. Absolute local path → used as-is
3. Remote URL → `http://` or `https://` passed to Puppeteer
4. Not found → warning logged, logo skipped

### Header on all pages

When `showOnAllPages: true`, the header is rendered via Puppeteer's native `headerTemplate` — it appears at the top of every page. When `false` (default), the header is part of the HTML body and only appears on page 1.

```json
"header": {
  "title": "Acme Corp — Confidential",
  "showOnAllPages": true
}
```

---

## Footer

```json
"footer": {
  "text": "© 2024 Acme Corp. All rights reserved."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | Footer text — appears at the bottom of every page |

The footer always renders on every page via Puppeteer's `footerTemplate`.

---

## Layout (Spacing Customisation)

Control the spacing between header, body, and footer using CSS values or percentages.

```json
"layout": {
  "headerHeight": "25mm",
  "footerHeight": "15mm",
  "bodyPaddingTop": "5mm",
  "bodyPaddingBottom": "5mm",
  "marginLeft": "20mm",
  "marginRight": "20mm"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `headerHeight` | string | `"20mm"` | Top margin / header area height |
| `footerHeight` | string | `"18mm"` | Bottom margin / footer area height |
| `bodyPaddingTop` | string | `"0mm"` | Extra space above body content |
| `bodyPaddingBottom` | string | `"0mm"` | Extra space below body content |
| `marginLeft` | string | `"15mm"` | Left page margin |
| `marginRight` | string | `"15mm"` | Right page margin |

Effective top margin = `headerHeight + bodyPaddingTop`
Effective bottom margin = `footerHeight + bodyPaddingBottom`

All values support `mm`, `px`, or `%`.

### Examples

Tight layout (more content per page):
```json
"layout": { "headerHeight": "12mm", "footerHeight": "10mm", "marginLeft": "10mm", "marginRight": "10mm" }
```

Spacious layout (more breathing room):
```json
"layout": { "headerHeight": "30mm", "footerHeight": "20mm", "bodyPaddingTop": "8mm", "bodyPaddingBottom": "8mm" }
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

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `text` | string | required | Paragraph text |
| `align` | `"left"` `"center"` `"right"` `"justify"` | `"left"` | Text alignment |

---

### `bulletList`

```json
{
  "type": "bulletList",
  "items": ["First item", "Second item", "Third item"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `items` | string[] | Yes (min 1) | List of bullet items |

---

### `table`

```json
{
  "type": "table",
  "headers": ["Name", "Role", "Department", "Location", "Start Date"],
  "rows": [
    ["Alice Johnson", "Engineer", "Platform", "London", "2021-03-01"],
    ["Bob Martinez", "Designer", "Product", "Berlin", "2022-07-15"]
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `headers` | string[] | Yes | Column header labels |
| `rows` | string[][] | Yes | Array of row arrays |

Tables use `table-layout: fixed` with `font-size: 8.5pt` to fit wide columns on A4.

---

### `grid`

Multi-column layout. Each column can have its own width, alignment, and nested content.

```json
{
  "type": "grid",
  "gap": "16px",
  "columns": [
    {
      "width": "40%",
      "align": "left",
      "content": [
        { "type": "paragraph", "text": "Left column" }
      ]
    },
    {
      "width": "60%",
      "align": "right",
      "content": [
        { "type": "paragraph", "text": "Right column" }
      ]
    }
  ]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `gap` | string | `"12px"` | CSS gap between columns |
| `columns` | GridColumn[] | required | Array of column definitions |

#### GridColumn

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `width` | string | `"1fr"` | CSS width: `"40%"`, `"1fr"`, `"200px"` |
| `align` | `"left"` `"center"` `"right"` | `"left"` | Text alignment for all content in column |
| `content` | ContentItem[] | required | Nested content (paragraph, table, bulletList) |

#### Grid examples

**2-column equal:**
```json
{
  "type": "grid",
  "columns": [
    { "content": [{ "type": "paragraph", "text": "Left" }] },
    { "content": [{ "type": "paragraph", "text": "Right" }] }
  ]
}
```

**3-column centered stats:**
```json
{
  "type": "grid",
  "gap": "16px",
  "columns": [
    { "content": [{ "type": "paragraph", "text": "$48.6M", "align": "center" }] },
    { "content": [{ "type": "paragraph", "text": "1,240", "align": "center" }] },
    { "content": [{ "type": "paragraph", "text": "93.8%", "align": "center" }] }
  ]
}
```

**Invoice-style label/value (left + right aligned):**
```json
{
  "type": "grid",
  "gap": "8px",
  "columns": [
    {
      "width": "40%",
      "content": [
        { "type": "paragraph", "text": "Invoice #:", "align": "left" },
        { "type": "paragraph", "text": "Due Date:", "align": "left" }
      ]
    },
    {
      "width": "60%",
      "content": [
        { "type": "paragraph", "text": "INV-2024-001", "align": "right" },
        { "type": "paragraph", "text": "30 April 2024", "align": "right" }
      ]
    }
  ]
}
```

**Wide content + narrow sidebar:**
```json
{
  "type": "grid",
  "gap": "20px",
  "columns": [
    {
      "width": "65%",
      "content": [
        { "type": "paragraph", "text": "Main content area." },
        { "type": "table", "headers": ["Item", "Qty"], "rows": [["Widget", "5"]] }
      ]
    },
    {
      "width": "35%",
      "content": [
        { "type": "paragraph", "text": "Sidebar notes." },
        { "type": "bulletList", "items": ["Note 1", "Note 2"] }
      ]
    }
  ]
}
```

---

## Custom Templates

Place `.hbs` files in the `templates/` directory at the project root.

```
templates/
├── invoice.hbs
├── report.hbs
└── receipt.hbs
```

Templates are standard Handlebars. The `data` JSON from the request is passed directly as the template context.

### Template resolution order

1. `src/template/<name>.hbs` — built-in templates
2. `templates/<name>.hbs` — custom templates

### Available Handlebars helpers

| Helper | Usage | Description |
|--------|-------|-------------|
| `eq` | `{{#if (eq type "paragraph")}}` | Equality check |
| `gridColumns` | `{{gridColumns columns}}` | Builds CSS `grid-template-columns` from column widths |

### Creating a custom template

1. Create `templates/my-template.hbs`
2. Use standard HTML + CSS + Handlebars syntax
3. Reference it in requests as `"template": "my-template"`

Example:
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial; padding: 40px; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>{{title}}</h1>
  <p>{{description}}</p>
  {{#each items}}
    <div>{{this.name}} — {{this.value}}</div>
  {{/each}}
</body>
</html>
```

Request:
```json
{
  "template": "my-template",
  "data": {
    "title": "Custom Report",
    "description": "Generated dynamically",
    "items": [
      { "name": "Revenue", "value": "$1.2M" },
      { "name": "Users", "value": "5,400" }
    ]
  }
}
```

---

## S3 Output

When `output.s3Bucket` is provided, the PDF is uploaded to S3 instead of returned as a blob.

```json
"output": {
  "s3Bucket": "my-pdf-bucket",
  "s3Folder": "invoices/2024"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `s3Bucket` | string | No | Bucket name. If blank → blob returned |
| `s3Folder` | string | No | Folder prefix (no trailing slash) |

File is uploaded as: `s3://<bucket>/<folder>/<timestamp>-<uuid>.pdf`

The `@aws-sdk/client-s3` is dynamically imported — only loaded when S3 output is actually used.

---

## Full Example — All Options

```json
{
  "template": "document",
  "data": {
    "header": {
      "logoUrl": "src/img/logo.png",
      "title": "Annual Report 2024",
      "description": "Comprehensive overview of all business units",
      "showOnAllPages": true
    },
    "body": [
      {
        "title": "Executive Summary",
        "content": [
          {
            "type": "paragraph",
            "text": "Revenue grew 21% year-over-year.",
            "align": "justify"
          },
          {
            "type": "bulletList",
            "items": ["Revenue: $48.6M", "Customers: 1,240", "Retention: 93.8%"]
          },
          {
            "type": "grid",
            "gap": "16px",
            "columns": [
              {
                "width": "50%",
                "align": "left",
                "content": [
                  { "type": "paragraph", "text": "Left column content" }
                ]
              },
              {
                "width": "50%",
                "align": "right",
                "content": [
                  { "type": "paragraph", "text": "Right column content" }
                ]
              }
            ]
          },
          {
            "type": "table",
            "headers": ["Region", "Q1", "Q2", "Q3", "Q4", "Total"],
            "rows": [
              ["North America", "820", "910", "1050", "1200", "3980"],
              ["EMEA", "680", "750", "820", "900", "3150"]
            ]
          }
        ]
      }
    ],
    "footer": {
      "text": "© 2024 Acme Corp. Confidential."
    },
    "layout": {
      "headerHeight": "25mm",
      "footerHeight": "15mm",
      "bodyPaddingTop": "5mm",
      "bodyPaddingBottom": "5mm",
      "marginLeft": "20mm",
      "marginRight": "20mm"
    }
  },
  "output": {
    "s3Bucket": "my-pdf-bucket",
    "s3Folder": "reports/2024"
  }
}
```

---

## Programmatic Usage

### Standalone (no NestJS)

```ts
import 'reflect-metadata';
import { PdfService } from './src/pdf.service';

const service = new PdfService();

// New API
const result = await service.generate({
  template: 'invoice',
  data: { invoiceNumber: 'INV-001', lineItems: [...] },
});
console.log(result.blob); // base64 PDF

// Legacy API
const legacy = await service.generatePdf({
  body: [{ title: 'Test', content: [{ type: 'paragraph', text: 'Hello' }] }],
});
console.log(legacy.filePath); // saved to pdf/ directory
```

### NestJS — inject PdfService

```ts
@Module({ imports: [PdfModule] })
export class AppModule {}

@Injectable()
export class MyService {
  constructor(private readonly pdf: PdfService) {}

  async buildInvoice(data: any) {
    return this.pdf.generate({
      template: 'invoice',
      data,
      output: { s3Bucket: 'invoices', s3Folder: '2024' },
    });
  }
}
```

### curl

```bash
# Blob response
curl -X POST http://localhost:3000/pdf/render \
  -H "Content-Type: application/json" \
  -d '{"template":"document","data":{...}}'

# S3 upload
curl -X POST http://localhost:3000/pdf/render \
  -H "Content-Type: application/json" \
  -d '{"template":"document","data":{...},"output":{"s3Bucket":"my-bucket"}}'

# Legacy endpoint — binary PDF
curl -X POST http://localhost:3000/pdf/generate \
  -H "Content-Type: application/json" \
  -d @examples/payload.json \
  --output report.pdf
```
