# Lambda Deployment Guide — json-to-pdf-generator

Deploy the PDF generator as an AWS Lambda function. The codebase already uses `puppeteer-core` + `@sparticuz/chromium` with auto-detection — no code changes needed.

---

## How It Works (Already Done)

`PdfService.launchBrowser()` auto-detects the environment:

- **Lambda** — `AWS_LAMBDA_FUNCTION_NAME` env var is set automatically by AWS → uses `@sparticuz/chromium` binary
- **Local** — env var absent → finds your installed Chrome via auto-detection or `CHROME_PATH`

No manual env config required. Same code runs in both environments.

---

## Current Dependencies (Already Installed)

```json
"dependencies": {
  "puppeteer-core": "^...",
  "@sparticuz/chromium": "^...",
  "@aws-sdk/client-s3": "^...",
  "handlebars": "^..."
}
```

---

## Step 1: Create the Lambda Handler

Create `lambda/handler.ts`:

```ts
import 'reflect-metadata';
import { PdfService } from '../src/pdf.service';
import { PdfGenerateResponse } from '../src/interfaces';

const service = new PdfService();

export const handler = async (event: any): Promise<any> => {
  const body = typeof event.body === 'string'
    ? JSON.parse(event.body)
    : event;

  // New flexible API — template + data + optional S3 output
  if (body.template) {
    const result: PdfGenerateResponse = await service.generate(body);

    // If S3 output was requested, return the URL
    if (result.s3Url) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: result.filename, s3Url: result.s3Url }),
      };
    }

    // Blob mode — return base64-encoded PDF
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
      body: result.blob,
      isBase64Encoded: true,
    };
  }

  // Legacy API — PdfDocumentDto
  const result = await service.generatePdf(body);
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
    },
    body: result.buffer.toString('base64'),
    isBase64Encoded: true,
  };
};
```

---

## Step 2: Lambda Configuration

| Setting | Value |
|---------|-------|
| Runtime | Node.js 20.x (recommended) or 18.x |
| Memory | 1536 MB minimum (2048 MB recommended) |
| Timeout | 30 seconds |
| Ephemeral storage (`/tmp`) | 512 MB (default is fine) |
| Architecture | x86_64 (arm64 also supported) |

---

## Step 3: Package and Deploy

### Option A: Single deployment package

```bash
# Build TypeScript
npm run build

# Copy templates (Handlebars files aren't compiled by tsc)
cp -r src/template dist/template
cp -r templates dist/../templates

# Zip for deployment
zip -r lambda.zip dist/ templates/ node_modules/ \
  -x "node_modules/puppeteer/.local-chromium/*"
```

### Option B: Lambda Layer for Chromium (recommended)

Keeps your function package small. Chromium layer is shared across functions.

```bash
# Create layer
mkdir -p layer/nodejs
cd layer/nodejs
npm init -y
npm install @sparticuz/chromium
cd ../..

# Zip the layer (~50MB)
cd layer
zip -r chromium-layer.zip nodejs/
```

Upload as a Lambda Layer, attach to your function. Remove `@sparticuz/chromium` from the function's `node_modules`.

---

## Step 4: API Gateway

Expose the Lambda via API Gateway:

```
POST /pdf/render   → Lambda (new flexible API)
POST /pdf/generate → Lambda (legacy API)
```

API Gateway config:
- Binary media types: `application/pdf`
- Payload format: 2.0 (HTTP API) or enable binary support (REST API)
- Timeout: 30 seconds

---

## Step 5: Invoke from Your App

### Option A: Direct Lambda invocation

```ts
import { Lambda } from '@aws-sdk/client-lambda';

const lambda = new Lambda({ region: 'us-east-1' });

// New API — template + data + optional S3
const response = await lambda.invoke({
  FunctionName: 'pdf-generator',
  Payload: JSON.stringify({
    template: 'invoice',
    data: { invoiceNumber: 'INV-001', lineItems: [...] },
    output: { s3Bucket: 'my-bucket', s3Folder: 'invoices' },
  }),
});

const result = JSON.parse(Buffer.from(response.Payload!).toString());
// result.s3Url = "s3://my-bucket/invoices/2024-01-15T10-30-00-000Z-<uuid>.pdf"
```

### Option B: Via API Gateway

```bash
# Get blob back
curl -X POST https://xxx.execute-api.us-east-1.amazonaws.com/pdf/render \
  -H "Content-Type: application/json" \
  -d '{"template":"invoice","data":{...}}' \
  --output invoice.pdf

# Upload to S3
curl -X POST https://xxx.execute-api.us-east-1.amazonaws.com/pdf/render \
  -H "Content-Type: application/json" \
  -d '{"template":"invoice","data":{...},"output":{"s3Bucket":"my-bucket","s3Folder":"invoices"}}'
```

---

## Request Format

### New Flexible API (`POST /pdf/render`)

```json
{
  "template": "invoice",
  "data": {
    "companyName": "Acme Corp",
    "invoiceNumber": "INV-2024-001",
    "lineItems": [...]
  },
  "output": {
    "s3Bucket": "my-pdf-bucket",
    "s3Folder": "invoices/2024"
  }
}
```

- `template` — name of `.hbs` file (without extension)
- `data` — any JSON, passed directly to the Handlebars template
- `output` — optional. If `s3Bucket` is provided → uploads to S3, returns URL. If omitted → returns base64 blob.

### Legacy API (`POST /pdf/generate`)

```json
{
  "header": { "logoUrl": "...", "title": "...", "showOnAllPages": true },
  "body": [{ "title": "...", "content": [...] }],
  "footer": { "text": "..." },
  "layout": {
    "headerHeight": "25mm",
    "footerHeight": "15mm",
    "bodyPaddingTop": "5mm"
  }
}
```

---

## Template Resolution

Templates are searched in order:
1. `src/template/<name>.hbs` — built-in templates
2. `templates/<name>.hbs` — custom templates at project root

For Lambda, ensure templates are included in the deployment package.

---

## S3 Output

When `output.s3Bucket` is provided:
- PDF is uploaded to `s3://<bucket>/<folder>/<filename>.pdf`
- Response contains `{ filename, s3Url }`
- Lambda needs `s3:PutObject` permission on the target bucket

IAM policy:
```json
{
  "Effect": "Allow",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::my-pdf-bucket/*"
}
```

---

## Cost Estimate

| Volume | Lambda cost (1536MB, ~3s/invocation) |
|--------|--------------------------------------|
| 1K/month | ~$0.08 (free tier covers this) |
| 10K/month | ~$0.75 |
| 100K/month | ~$7.50 |
| 1M/month | ~$75 |

Add API Gateway: ~$1 per million requests.

---

## Checklist

- [ ] Create `lambda/handler.ts`
- [ ] Configure Lambda (memory: 1536MB+, timeout: 30s)
- [ ] Include templates in deployment package
- [ ] Deploy (single package or Chromium layer)
- [ ] Set up API Gateway with binary media support
- [ ] Add S3 permissions if using S3 output
- [ ] Update app server to invoke Lambda
- [ ] Test cold start (~3–5s) and warm invocation (~1–3s)
- [ ] Monitor with CloudWatch
