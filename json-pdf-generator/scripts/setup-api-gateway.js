#!/usr/bin/env node
/**
 * Creates an HTTP API Gateway for the PDF Generator Lambda.
 * Reads config from .env.lambda.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

process.env.AWS_PAGER = '';

// ─── Resolve environment ────────────────────────────────────────────────────
const env = process.argv[2] || '';
const envSuffix = env ? `.${env}` : '';
const envFile = path.join(process.cwd(), `.env.lambda${envSuffix}`);
if (!fs.existsSync(envFile)) {
  console.error(`ERROR: ${envFile} not found.`);
  console.error('Usage: node scripts/setup-api-gateway.js [qa|staging|prod]');
  process.exit(1);
}
console.log(`Environment: ${env || 'default'} (${envFile})`);

const cfg = {};
fs.readFileSync(envFile, 'utf-8').split('\n').forEach(line => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;
  const idx = line.indexOf('=');
  if (idx > 0) cfg[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
});

const REGION = cfg.AWS_REGION;
const FN = cfg.FUNCTION_NAME;
const API_NAME = cfg.API_GATEWAY_NAME || 'pdf-generator-api';

// Find AWS CLI
function findAwsCli() {
  const candidates = [
    'C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe',
    'C:\\Program Files (x86)\\Amazon\\AWSCLIV2\\aws.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Amazon', 'AWSCLIV2', 'aws.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return `"${p}"`;
  }
  return 'aws';
}
const AWS = findAwsCli();

function aws(args) {
  return execSync(`${AWS} ${args}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
}

console.log('\n=== API Gateway Setup ===');
console.log(`  Region: ${REGION} | Function: ${FN}\n`);

// ─── 1. Get Lambda ARN ─────────────────────────────────────────────────────
console.log('[1/4] Getting Lambda ARN...');
const fnInfo = JSON.parse(aws(`lambda get-function --function-name ${FN} --region ${REGION} --output json`));
const lambdaArn = fnInfo.Configuration.FunctionArn;
console.log(`  ARN: ${lambdaArn}`);

// ─── 2. Create HTTP API ────────────────────────────────────────────────────
console.log('[2/4] Creating HTTP API...');

// Check if API already exists
let apiId = '';
try {
  const apis = JSON.parse(aws(`apigatewayv2 get-apis --region ${REGION} --output json`));
  const existing = apis.Items.find(a => a.Name === API_NAME);
  if (existing) {
    apiId = existing.ApiId;
    console.log(`  API exists: ${apiId}`);
  }
} catch (e) { }

if (!apiId) {
  const createResult = JSON.parse(aws(
    `apigatewayv2 create-api --name ${API_NAME} --protocol-type HTTP --region ${REGION} --output json`
  ));
  apiId = createResult.ApiId;
  console.log(`  Created API: ${apiId}`);
}

// ─── 3. Create Lambda Integration + Route ──────────────────────────────────
console.log('[3/4] Setting up integration and route...');

// Create integration
const accountId = lambdaArn.split(':')[4];
const integrationUri = `arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${lambdaArn}/invocations`;

let integrationId = '';
try {
  const integrations = JSON.parse(aws(
    `apigatewayv2 get-integrations --api-id ${apiId} --region ${REGION} --output json`
  ));
  const existing = integrations.Items.find(i => i.IntegrationUri === integrationUri);
  if (existing) {
    integrationId = existing.IntegrationId;
    console.log(`  Integration exists: ${integrationId}`);
  }
} catch (e) { }

if (!integrationId) {
  const intResult = JSON.parse(aws(
    `apigatewayv2 create-integration --api-id ${apiId} --integration-type AWS_PROXY --integration-method POST --integration-uri ${integrationUri} --payload-format-version 2.0 --region ${REGION} --output json`
  ));
  integrationId = intResult.IntegrationId;
  console.log(`  Created integration: ${integrationId}`);
}

// Create route
let routeExists = false;
try {
  const routes = JSON.parse(aws(
    `apigatewayv2 get-routes --api-id ${apiId} --region ${REGION} --output json`
  ));
  routeExists = routes.Items.some(r => r.RouteKey === 'POST /pdf/render');
} catch (e) { }

if (!routeExists) {
  aws(
    `apigatewayv2 create-route --api-id ${apiId} --route-key "POST /pdf/render" --target integrations/${integrationId} --region ${REGION} --output json`
  );
  console.log('  Created route: POST /pdf/render');
} else {
  console.log('  Route exists: POST /pdf/render');
}

// Create default stage (auto-deploy)
try {
  aws(`apigatewayv2 get-stage --api-id ${apiId} --stage-name "$default" --region ${REGION} --output json`);
  console.log('  Stage exists: $default');
} catch (e) {
  aws(`apigatewayv2 create-stage --api-id ${apiId} --stage-name "$default" --auto-deploy --region ${REGION} --output json`);
  console.log('  Created stage: $default (auto-deploy)');
}

// ─── 4. Add Lambda Permission ──────────────────────────────────────────────
console.log('[4/4] Adding Lambda invoke permission...');
try {
  aws(
    `lambda add-permission --function-name ${FN} --statement-id apigateway-invoke --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:${REGION}:${accountId}:${apiId}/*" --region ${REGION} --output json`
  );
  console.log('  Permission added');
} catch (e) {
  if (e.message && e.message.includes('already exists')) {
    console.log('  Permission already exists');
  } else {
    console.log('  Permission may already exist (continuing)');
  }
}

// ─── Done ───────────────────────────────────────────────────────────────────
const apiUrl = `https://${apiId}.execute-api.${REGION}.amazonaws.com`;
console.log(`\n=== API Gateway Ready ===`);
console.log(`  URL: ${apiUrl}`);
console.log(`  Endpoint: POST ${apiUrl}/pdf/render\n`);
console.log('Test:');
console.log(`  curl -X POST ${apiUrl}/pdf/render -H "Content-Type: application/json" -d "{\\"template\\":\\"document\\",\\"data\\":{\\"body\\":[{\\"title\\":\\"Test\\",\\"content\\":[{\\"type\\":\\"paragraph\\",\\"text\\":\\"Hello\\"}]}]}}"\n`);
