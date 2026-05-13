# Usage Guide — json-to-pdf-generator

Complete reference for all features, options, and content types.

---

## API: `POST /pdf/render`

Single endpoint for all PDF generation.

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
  "s3Url": "https://my-pdf-bucket.s3.ap-south-1.amazonaws.com/reports/2024/..."
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

## Header

Two modes: **logo + title** or **full-width image**.

### Mode 1: Logo + Title + Description

```json
"header": {
  "logoUrl": "src/img/logo.png",
  "title": "Monthly Report",
  "description": "Generated on 2024-04-01",
  "showOnAllPages": false
}
```

### Mode 2: Full-width header image

When `imageUrl` is provided, it replaces the logo+title+description entirely. The image spans the full page width edge-to-edge.

```json
"header": {
  "imageUrl": "https://my-bucket.s3.amazonaws.com/letterhead.png"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `logoUrl` | string | — | Logo image (local path, URL, or data URI blob) |
| `imageUrl` | string | — | Full-width header image (replaces logo+title when set) |
| `title` | string | — | Header title text |
| `description` | string | — | Subtitle / description |
| `showOnAllPages` | boolean | `false` | `true` = header on every page, `false` = first page only |

### `showOnAllPages` behavior

| `imageUrl` | `showOnAllPages` | Result |
|---|---|---|
| set | `false` (default) | Image appears on first page only, edge-to-edge with 0 margins |
| set | `true` | Image repeats on every page via Puppeteer's header template |
| not set | `false` | Logo+title in HTML body — first page only |
| not set | `true` | Logo+title repeats on every page via Puppeteer's header template |

When using `showOnAllPages: true` with `imageUrl`, the service **auto-calculates** `headerHeight` based on the image's aspect ratio so body content doesn't overlap. You can still override it manually if needed:

```json
"header": {
  "imageUrl": "https://my-bucket.s3.amazonaws.com/letterhead.png",
  "showOnAllPages": true
},
"layout": {
  "headerHeight": "55mm"
}
```

> If `headerHeight` is not provided, it's auto-calculated from the image dimensions (image width scaled to A4 page width + 2mm padding).

### Image/Logo source formats

All image fields (`logoUrl`, `imageUrl`, and `image` content type) support:

| Format | Example | How it works |
|--------|---------|--------------|
| Local file path | `"src/img/logo.png"` | Read from disk, converted to base64 data URI |
| Remote URL | `"https://bucket.s3.amazonaws.com/img.png"` | Fetched server-side, converted to data URI |
| Data URI (blob) | `"data:image/png;base64,iVBORw0KGgo..."` | Used directly as-is |

Remote images are fetched at generation time and embedded in the PDF — no network dependency during rendering.

---

## Footer

```json
"footer": {
  "text": "© 2024 Acme Corp. All rights reserved."
}
```

The footer renders at the bottom of every page.

---

## Layout (Spacing Customisation)

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

> **Note on `imageUrl`:**
> - When `imageUrl` is used with `showOnAllPages: false` (default), the image renders in the HTML body on the first page only. Normal margins apply.
> - When `imageUrl` is used with `showOnAllPages: true`, the image repeats on every page via Puppeteer's header template. `headerHeight` is auto-calculated from the image dimensions if not explicitly set.

---

## Content Types

### `paragraph`

```json
{
  "type": "paragraph",
  "text": "Your text here.",
  "align": "justify",
  "style": "color:#333; font-weight:bold"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `text` | string | required | Paragraph text (supports `\n` for line breaks) |
| `align` | `"left"` `"center"` `"right"` `"justify"` | `"left"` | Text alignment |
| `style` | string | — | Inline CSS applied to the `<p>` element |

---

### `bulletList`

Items can be plain strings or rich objects with `{ text, style }`.

```json
{
  "type": "bulletList",
  "style": "margin-left:30px",
  "items": [
    "Plain item",
    { "text": "Bold item", "style": "font-weight:bold" },
    { "text": "Red item", "style": "color:red" }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `items` | (string \| {text, style})[] | Yes (min 1) | List items |
| `style` | string | No | Inline CSS on the `<ul>` element |

---

### `table`

Headers and cells can be plain strings or rich objects with `{ text, style }`.

```json
{
  "type": "table",
  "style": "font-size:10pt",
  "headers": [
    "Name",
    { "text": "Amount", "style": "text-align:right; color:#1565c0" }
  ],
  "rows": [
    ["License", { "text": "$6,000", "style": "font-weight:bold; color:green" }],
    ["Support", "$1,200"]
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `headers` | (string \| {text, style})[] | Yes | Column headers |
| `rows` | (string \| {text, style})[][] | Yes | Row data |
| `style` | string | No | Inline CSS on the `<table>` element |

---

### `image`

Display an image inline in the content — works in sections, grids, and anywhere content items are accepted.

```json
{
  "type": "image",
  "src": "https://example.com/chart.png",
  "width": "100%",
  "align": "center",
  "style": "border:1px solid #ccc; border-radius:4px"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `src` | string | required | Image source (local path, URL, or data URI) |
| `width` | string | `"auto"` | CSS width (e.g. `"200px"`, `"50%"`, `"100%"`) |
| `height` | string | `"auto"` | CSS height |
| `align` | `"left"` `"center"` `"right"` | `"left"` | Horizontal alignment |
| `style` | string | — | Inline CSS on the `<img>` element |

#### Image examples

**Full-width chart:**
```json
{ "type": "image", "src": "https://my-bucket.s3.amazonaws.com/chart.png", "width": "100%", "align": "center" }
```

**Small signature aligned right:**
```json
{ "type": "image", "src": "src/img/signature.png", "width": "120px", "align": "right" }
```

**Image in a grid column:**
```json
{
  "type": "grid",
  "columns": [
    {
      "width": "30%",
      "content": [
        { "type": "image", "src": "https://example.com/photo.png", "width": "100%" }
      ]
    },
    {
      "width": "70%",
      "content": [
        { "type": "paragraph", "text": "Description next to the image." }
      ]
    }
  ]
}
```

---

### `grid`

Multi-column layout. Each column can contain any content type including images.

```json
{
  "type": "grid",
  "gap": "16px",
  "style": "border:1px solid #e0e0e0; padding:12px",
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
| `style` | string | — | Inline CSS on the grid container |
| `columns` | GridColumn[] | required | Array of column definitions |

#### GridColumn

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `width` | string | `"1fr"` | CSS width: `"40%"`, `"1fr"`, `"200px"` |
| `align` | `"left"` `"center"` `"right"` | `"left"` | Text alignment for column |
| `content` | ContentItem[] | required | Nested content (paragraph, table, bulletList, image) |

---

## Inline Styling

Every content item supports an optional `style` field for inline CSS. This gives fine-grained control over appearance.

### On paragraphs

```json
{ "type": "paragraph", "text": "Important!", "style": "font-weight:bold; color:red; font-size:14pt" }
```

### On sections

```json
{
  "title": "Highlighted Section",
  "style": "background:#f8f9fa; padding:12px; border-radius:6px; border-left:4px solid #1565c0",
  "content": [...]
}
```

### On bullet list items

```json
{
  "type": "bulletList",
  "items": [
    { "text": "Critical", "style": "font-weight:bold; color:#d32f2f" },
    "Normal item",
    { "text": "Info", "style": "color:#1565c0" }
  ]
}
```

### On table cells

```json
{
  "type": "table",
  "headers": ["Item", { "text": "Total", "style": "text-align:right; background:#e3f2fd" }],
  "rows": [
    ["Widget", { "text": "$5,000", "style": "font-weight:bold; text-align:right; color:green" }]
  ]
}
```

### On grids

```json
{ "type": "grid", "style": "border:1px solid #ddd; padding:16px; border-radius:8px", "columns": [...] }
```

---

## Newlines (`\n`)

Use `\n` in any text field to create line breaks. They are converted to `<br>` in the rendered HTML.

### In paragraphs

```json
{ "type": "paragraph", "text": "Line one\nLine two\nLine three" }
```

### In bullet list items

```json
{
  "type": "bulletList",
  "items": [
    "Single line",
    { "text": "First line\nSecond line", "style": "color:#555" }
  ]
}
```

### In table cells

```json
{
  "type": "table",
  "headers": ["Name", "Address"],
  "rows": [
    ["Acme Corp", { "text": "123 Main St\nSuite 400\nNew York, NY", "style": "line-height:1.6" }]
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

### Template resolution order

1. `src/template/<name>.hbs` — built-in templates
2. `templates/<name>.hbs` — custom templates

### Available Handlebars helpers

| Helper | Usage | Description |
|--------|-------|-------------|
| `eq` | `{{#if (eq type "paragraph")}}` | Equality check |
| `gridColumns` | `{{gridColumns columns}}` | Builds CSS `grid-template-columns` |
| `nl2br` | `{{nl2br text}}` | Converts `\n` to `<br>` |
| `cellText` | `{{cellText item}}` | Extracts text from string or `{text, style}` object |
| `cellStyle` | `{{cellStyle item}}` | Extracts style from `{text, style}` object |

### Creating a custom template

1. Create `templates/my-template.hbs`
2. Use standard HTML + CSS + Handlebars syntax
3. Reference it as `"template": "my-template"`

---

## S3 Output

When `output.s3Bucket` is provided, the PDF is uploaded to S3.

```json
"output": {
  "s3Bucket": "my-pdf-bucket",
  "s3Folder": "invoices/2024"
}
```

File is uploaded as: `<folder>/<timestamp>-<uuid>.pdf`

The Lambda function needs `s3:PutObject` permission on the target bucket.

---

## Full Example

```json
{
  "template": "document",
  "data": {
    "header": {
      "imageUrl": "https://my-bucket.s3.amazonaws.com/letterhead.png"
    },
    "body": [
      {
        "title": "Invoice",
        "style": "border-left:4px solid #1565c0; padding-left:12px",
        "content": [
          {
            "type": "paragraph",
            "text": "Dear Customer,\nPlease find your invoice below.\nThank you for your business.",
            "style": "color:#333; line-height:1.8"
          },
          {
            "type": "image",
            "src": "https://my-bucket.s3.amazonaws.com/qr-code.png",
            "width": "80px",
            "align": "right",
            "style": "margin-top:8px"
          },
          {
            "type": "grid",
            "gap": "8px",
            "columns": [
              {
                "width": "40%",
                "content": [
                  { "type": "paragraph", "text": "Invoice #:", "style": "color:#777" },
                  { "type": "paragraph", "text": "Date:", "style": "color:#777" },
                  { "type": "paragraph", "text": "Due:", "style": "color:#777" }
                ]
              },
              {
                "width": "60%",
                "align": "right",
                "content": [
                  { "type": "paragraph", "text": "INV-2024-001", "align": "right" },
                  { "type": "paragraph", "text": "1 May 2024", "align": "right" },
                  { "type": "paragraph", "text": "31 May 2024", "align": "right", "style": "font-weight:bold; color:#d32f2f" }
                ]
              }
            ]
          },
          {
            "type": "table",
            "style": "margin-top:12px",
            "headers": ["Item", "Qty", { "text": "Total", "style": "text-align:right" }],
            "rows": [
              ["Platform License", "5", { "text": "$6,000", "style": "text-align:right" }],
              ["Support Package", "1", { "text": "$2,400", "style": "text-align:right" }],
              [{ "text": "Grand Total", "style": "font-weight:bold" }, "", { "text": "$8,400", "style": "text-align:right; font-weight:bold; color:#1565c0; font-size:11pt" }]
            ]
          },
          {
            "type": "bulletList",
            "style": "margin-top:12px",
            "items": [
              { "text": "Payment terms: Net 30", "style": "font-weight:bold" },
              "Wire transfer to account ending 4821",
              { "text": "Late payments subject to 1.5% monthly fee", "style": "color:#d32f2f; font-size:9pt" }
            ]
          }
        ]
      }
    ],
    "footer": {
      "text": "© 2024 Acme Corp. | support@acme.com | +1-555-0100"
    }
  },
  "output": {
    "s3Bucket": "my-pdf-bucket",
    "s3Folder": "invoices/2024"
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

const result = await service.generate({
  template: 'document',
  data: {
    header: { imageUrl: 'https://...' },
    body: [{ title: 'Test', content: [{ type: 'paragraph', text: 'Hello\nWorld' }] }],
  },
});
console.log(result.blob); // base64 PDF
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
  -d @examples/postman-mock-data.json

# Save PDF locally from blob response
curl -s -X POST http://localhost:3000/pdf/render \
  -H "Content-Type: application/json" \
  -d @examples/payload.json | \
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);require('fs').writeFileSync('output.pdf',Buffer.from(r.blob,'base64'))})"
```
