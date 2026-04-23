# API Gateway Setup for PDF Generator Lambda

Two options: automated script or manual AWS Console steps.

---

## Option 1: Automated (recommended)

```bash
npm run lambda:setup-api
```

This creates an HTTP API Gateway with a `POST /pdf/render` route pointing to your Lambda.

---

## Option 2: AWS Console (manual)

### Step 1: Create HTTP API

1. Go to [API Gateway Console](https://console.aws.amazon.com/apigateway/)
2. Click **Create API**
3. Under **HTTP API**, click **Build**
4. API name: `pdf-generator-api`
5. Click **Next**

### Step 2: Add Integration

1. Click **Add integration**
2. Integration type: **Lambda**
3. Lambda function: `pdf-generator` (select your region)
4. Click **Next**

### Step 3: Configure Route

1. Method: **POST**
2. Resource path: `/pdf/render`
3. Integration target: the Lambda integration from Step 2
4. Click **Next**

### Step 4: Configure Stage

1. Stage name: `$default` (auto-deploy)
2. Click **Next**
3. Click **Create**

### Step 5: Enable Binary Media Types

1. Go to your API → **API settings** (left sidebar)
2. Under **Media types**, add: `application/pdf`
3. Save

### Step 6: Get Your URL

After creation, you'll see the **Invoke URL** on the API details page:
```
https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com
```

Your endpoint is:
```
POST https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/pdf/render
```

### Step 7: Test

```bash
curl -X POST https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/pdf/render \
  -H "Content-Type: application/json" \
  -d "{\"template\":\"document\",\"data\":{\"body\":[{\"title\":\"Test\",\"content\":[{\"type\":\"paragraph\",\"text\":\"Hello from API Gateway\"}]}]}}"
```

---

## Usage from Your App

### Blob response (no S3)

```ts
const response = await fetch('https://xxx.execute-api.ap-south-1.amazonaws.com/pdf/render', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    template: 'document',
    data: {
      body: [{ title: 'Report', content: [{ type: 'paragraph', text: 'Hello' }] }],
      footer: { text: '© 2024' }
    }
  })
});

const result = await response.json();
// result.blob = base64-encoded PDF
const pdfBuffer = Buffer.from(result.blob, 'base64');
```

### S3 upload

```ts
const response = await fetch('https://xxx.execute-api.ap-south-1.amazonaws.com/pdf/render', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    template: 'invoice',
    data: { invoiceNumber: 'INV-001', lineItems: [...] },
    output: { s3Bucket: 'my-bucket', s3Folder: 'invoices' }
  })
});

const result = await response.json();
// result.s3Url = "s3://my-bucket/invoices/2024-01-15T10-30-00-000Z-<uuid>.pdf"
```

---

## Security (Optional)

By default the HTTP API is public. To restrict access:

1. **API Key** — API Gateway → Routes → Attach API key requirement
2. **IAM Auth** — Require AWS SigV4 signed requests
3. **JWT Authorizer** — Attach a Cognito or custom JWT authorizer
4. **CORS** — Configure allowed origins in API settings
