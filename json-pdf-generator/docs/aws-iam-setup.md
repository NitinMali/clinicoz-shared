# AWS IAM Role Setup for Lambda PDF Generator

Step-by-step guide to create the IAM role via the AWS Console.

---

## Step 1: Open IAM Console

1. Go to [AWS IAM Console](https://console.aws.amazon.com/iam/)
2. In the left sidebar, click **Roles**
3. Click **Create role**

---

## Step 2: Select Trusted Entity

1. Under "Trusted entity type", select **AWS service**
2. Under "Use case", select **Lambda**
3. Click **Next**

---

## Step 3: Attach Permissions

Search for and check these policies:

**Required:**
- `AWSLambdaBasicExecutionRole` — allows Lambda to write logs to CloudWatch

**If using S3 output (recommended):**
- Don't attach a managed S3 policy here — we'll create a scoped inline policy in Step 5

Click **Next**

---

## Step 4: Name the Role

1. Role name: `lambda-pdf-generator-role`
2. Description: `Execution role for PDF generator Lambda function`
3. Click **Create role**

---

## Step 5: Add S3 Permissions (if using S3 output)

1. After the role is created, click on the role name `lambda-pdf-generator-role`
2. Go to the **Permissions** tab
3. Click **Add permissions** → **Create inline policy**
4. Click the **JSON** tab
5. Paste this policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    }
  ]
}
```

6. Replace `YOUR-BUCKET-NAME` with your actual S3 bucket name
7. For multiple buckets, add more entries to the Resource array:
```json
"Resource": [
  "arn:aws:s3:::bucket-one/*",
  "arn:aws:s3:::bucket-two/*"
]
```
8. Click **Next**
9. Policy name: `pdf-generator-s3-write`
10. Click **Create policy**

---

## Step 6: Copy the Role ARN

1. On the role summary page, find the **ARN** at the top
2. It looks like: `arn:aws:iam::123456789012:role/lambda-pdf-generator-role`
3. Copy it and paste into your `.env.lambda` file:

```
LAMBDA_ROLE_ARN=arn:aws:iam::123456789012:role/lambda-pdf-generator-role
```

---

## Final Permissions Summary

| Permission | Source | Purpose |
|------------|--------|---------|
| `logs:CreateLogGroup` | AWSLambdaBasicExecutionRole | Create CloudWatch log group |
| `logs:CreateLogStream` | AWSLambdaBasicExecutionRole | Create log streams |
| `logs:PutLogEvents` | AWSLambdaBasicExecutionRole | Write log entries |
| `s3:PutObject` | Inline policy | Upload PDFs to S3 (optional) |

---

## Verify

After deploying the Lambda, you can verify the role is working:

```bash
aws lambda invoke \
  --function-name pdf-generator \
  --payload '{"template":"document","data":{"body":[{"title":"Test","content":[{"type":"paragraph","text":"Hello"}]}]}}' \
  --cli-binary-format raw-in-base64-out \
  output.json
```

If you see a successful response, the role is configured correctly. If you get an "Access Denied" error on S3 upload, double-check the bucket name in the inline policy.
