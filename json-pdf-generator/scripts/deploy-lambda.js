#!/usr/bin/env node
/**
 * Lambda deploy script — works on Windows, Mac, Linux.
 * Reads config from .env.lambda, builds, packages, and deploys.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Disable AWS CLI pager (prevents "-- More --" blocking the terminal)
process.env.AWS_PAGER = '';

const isWindows = os.platform() === 'win32';

/**
 * Cross-platform zip: uses PowerShell on Windows, zip CLI on Linux/Mac.
 * @param {string[]} sources - paths to include
 * @param {string} dest - output zip path
 * @param {boolean} update - if true, add to existing zip (Linux only)
 */
function createZip(sources, dest, update = false) {
  if (isWindows) {
    const srcList = sources.map(s => `'${s}'`).join(',');
    const flag = update ? '-Update' : '-Force';
    execSync(`powershell -Command "Compress-Archive -Path ${srcList} -DestinationPath '${dest}' ${flag}"`, { stdio: 'pipe' });
  } else {
    if (update) {
      // Add to existing zip
      for (const src of sources) {
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          const basename = path.basename(src);
          const parent = path.dirname(src);
          execSync(`cd "${parent}" && zip -rq "${dest}" "${basename}"`, { stdio: 'pipe', shell: '/bin/bash' });
        } else {
          execSync(`zip -jq "${dest}" "${src}"`, { stdio: 'pipe' });
        }
      }
    } else {
      // Create new zip
      const args = sources.map(s => `"${s}"`).join(' ');
      execSync(`zip -rq "${dest}" ${args}`, { stdio: 'pipe' });
    }
  }
}

// Disable AWS CLI pager (prevents "-- More --" blocking the terminal)
process.env.AWS_PAGER = '';

// ─── Resolve environment ────────────────────────────────────────────────────
const env = process.argv[2] || '';  // e.g. "qa", "staging", "prod"
const envSuffix = env ? `.${env}` : '';
const envFile = path.join(process.cwd(), `.env.lambda${envSuffix}`);

if (!fs.existsSync(envFile)) {
  console.error(`ERROR: ${envFile} not found.`);
  console.error('Usage: node scripts/deploy-lambda.js [qa|staging|prod]');
  console.error('  No arg = uses .env.lambda (default)');
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

const REGION   = cfg.AWS_REGION;
const FN       = cfg.FUNCTION_NAME;
const ROLE     = cfg.LAMBDA_ROLE_ARN;
const RT       = cfg.RUNTIME;
const MEM      = cfg.MEMORY;
const TO       = cfg.TIMEOUT;
const LN       = cfg.LAYER_NAME;
const S3B      = cfg.DEPLOY_S3_BUCKET;
const HANDLER  = 'dist/lambda/handler.handler';

// Find AWS CLI executable
function findAwsCli() {
  const candidates = [
    'C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe',
    'C:\\Program Files (x86)\\Amazon\\AWSCLIV2\\aws.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Amazon', 'AWSCLIV2', 'aws.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return `"${p}"`;
  }
  // Try bare 'aws' as fallback
  return 'aws';
}
const AWS_CLI = findAwsCli();
console.log(`AWS CLI: ${AWS_CLI}`);

function run(cmd, opts) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', ...opts }).trim();
  } catch (e) {
    return e.stdout ? e.stdout.trim() : '';
  }
}

function aws(args) {
  return run(`${AWS_CLI} ${args}`);
}

console.log('\n=== PDF Generator Lambda Deploy ===');
console.log(`  Region: ${REGION} | Function: ${FN} | Memory: ${MEM}MB\n`);

// ─── 1. Build ───────────────────────────────────────────────────────────────
console.log('[1/5] Building...');
execSync('npm run build', { stdio: 'inherit' });

// Copy templates to all possible locations
const srcTpl = path.join('src', 'template');
const copyTargets = [
  path.join('dist', 'template'),
  path.join('dist', 'src', 'template'),
];
if (fs.existsSync(srcTpl)) {
  for (const dst of copyTargets) {
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(srcTpl).forEach(f => {
      fs.copyFileSync(path.join(srcTpl, f), path.join(dst, f));
    });
  }
}
if (!fs.existsSync('templates')) fs.mkdirSync('templates', { recursive: true });

// ─── 2. Chromium Layer ──────────────────────────────────────────────────────
console.log('[2/5] Checking Chromium layer...');
let layerArn = '';
try {
  const layers = JSON.parse(aws(`lambda list-layers --region ${REGION} --output json`));
  const found = layers.Layers.find(l => l.LayerName === LN);
  if (found) layerArn = found.LatestMatchingVersion.LayerVersionArn;
} catch (e) { /* no layers yet */ }

if (!layerArn) {
  if (!S3B || S3B === 'your-deploy-bucket-name') {
    console.error('  ERROR: Set DEPLOY_S3_BUCKET in .env.lambda');
    process.exit(1);
  }
  console.log('  Creating layer via S3...');

  const tmpDir = path.join(os.tmpdir(), 'chromium-layer');
  const njDir = path.join(tmpDir, 'nodejs');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  fs.mkdirSync(njDir, { recursive: true });

  execSync('npm init -y', { cwd: njDir, stdio: 'pipe' });
  console.log('  Installing @sparticuz/chromium (this takes a minute)...');
  execSync('npm install @sparticuz/chromium', { cwd: njDir, stdio: 'pipe' });

  // Zip the layer
  const layerZip = path.join(os.tmpdir(), 'chromium-layer.zip');
  if (fs.existsSync(layerZip)) fs.unlinkSync(layerZip);
  createZip([njDir], layerZip);

  const sizeMB = (fs.statSync(layerZip).size / 1024 / 1024).toFixed(1);
  console.log(`  Layer zip: ${sizeMB}MB — uploading to s3://${S3B}/lambda-layers/`);

  execSync(`${AWS_CLI} s3 cp "${layerZip}" "s3://${S3B}/lambda-layers/chromium-layer.zip" --region ${REGION}`, { stdio: 'inherit' });

  const publishOutput = execSync(
    `${AWS_CLI} lambda publish-layer-version --layer-name ${LN} --compatible-runtimes ${RT} --content S3Bucket=${S3B},S3Key=lambda-layers/chromium-layer.zip --region ${REGION} --output json`,
    { encoding: 'utf-8', stdio: 'pipe' }
  ).trim();
  console.log('  publish-layer-version response:', publishOutput.slice(0, 200));
  const result = JSON.parse(publishOutput);
  layerArn = result.LayerVersionArn;
  console.log(`  Layer created: ${layerArn}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.unlinkSync(layerZip);
} else {
  console.log(`  Layer exists: ${layerArn}`);
}

// ─── 3. Package ─────────────────────────────────────────────────────────────
console.log('[3/5] Packaging...');
const crypto = require('crypto');
const pkgDir = path.join(os.tmpdir(), 'lambda-pkg');
const lockHash = crypto.createHash('md5').update(fs.readFileSync('package-lock.json')).digest('hex');
const cacheMarker = path.join(pkgDir, '.lock-hash');

// Only run npm ci if package-lock.json changed since last deploy
const needsInstall = !fs.existsSync(cacheMarker) || fs.readFileSync(cacheMarker, 'utf-8') !== lockHash;

if (needsInstall) {
  console.log('  Installing production deps (lock file changed)...');
  if (fs.existsSync(pkgDir)) fs.rmSync(pkgDir, { recursive: true });
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.copyFileSync('package.json', path.join(pkgDir, 'package.json'));
  fs.copyFileSync('package-lock.json', path.join(pkgDir, 'package-lock.json'));
  execSync('npm ci --omit=dev', { cwd: pkgDir, stdio: 'pipe' });
  // Remove chromium — it's in the layer
  const sparticuz = path.join(pkgDir, 'node_modules', '@sparticuz');
  if (fs.existsSync(sparticuz)) fs.rmSync(sparticuz, { recursive: true });
  fs.writeFileSync(cacheMarker, lockHash);
} else {
  console.log('  Using cached node_modules (lock file unchanged)');
}

const lambdaZip = path.join(process.cwd(), 'lambda.zip');
if (fs.existsSync(lambdaZip)) fs.unlinkSync(lambdaZip);

// Create zip: dist + templates + node_modules
createZip(['dist', 'templates'], lambdaZip);
createZip([path.join(pkgDir, 'node_modules')], lambdaZip, true);

const pkgSize = (fs.statSync(lambdaZip).size / 1024 / 1024).toFixed(1);
console.log(`  Package: ${pkgSize}MB`);

// ─── 4. Deploy ──────────────────────────────────────────────────────────────
console.log('[4/5] Deploying...');

let fnExists = false;
try {
  execSync(`${AWS_CLI} lambda get-function --function-name ${FN} --region ${REGION}`, { encoding: 'utf-8', stdio: 'pipe' });
  fnExists = true;
} catch (e) { }

// Always upload via S3 — direct upload is unreliable for packages near the 50MB limit
console.log(`  Uploading ${pkgSize}MB via S3...`);
const s3Key = `lambda-deploy/${FN}-${Date.now()}.zip`;
execSync(`${AWS_CLI} s3 cp "${lambdaZip}" "s3://${S3B}/${s3Key}" --region ${REGION}`, { stdio: 'inherit' });

if (!fnExists) {
  console.log(`  Creating: ${FN}`);
  execSync(
    `${AWS_CLI} lambda create-function --function-name ${FN} --runtime ${RT} --handler ${HANDLER} --code S3Bucket=${S3B},S3Key=${s3Key} --role ${ROLE} --memory-size ${MEM} --timeout ${TO} --layers ${layerArn} --region ${REGION} --environment "Variables={NODE_OPTIONS=--max-old-space-size=1536}"`,
    { stdio: 'pipe' }
  );
} else {
  console.log(`  Updating: ${FN}`);
  execSync(`${AWS_CLI} lambda update-function-code --function-name ${FN} --s3-bucket ${S3B} --s3-key ${s3Key} --region ${REGION}`, { stdio: 'pipe' });
  execSync(`${AWS_CLI} lambda wait function-updated --function-name ${FN} --region ${REGION}`, { stdio: 'pipe' });
  execSync(`${AWS_CLI} lambda update-function-configuration --function-name ${FN} --memory-size ${MEM} --timeout ${TO} --layers ${layerArn} --region ${REGION}`, { stdio: 'pipe' });
}

// Clean up S3 artifact
execSync(`${AWS_CLI} s3 rm "s3://${S3B}/${s3Key}" --region ${REGION}`, { stdio: 'pipe' });

// ─── 5. Verify ──────────────────────────────────────────────────────────────
console.log('[5/5] Verifying...');
execSync(`${AWS_CLI} lambda wait function-active --function-name ${FN} --region ${REGION}`, { stdio: 'pipe' });

console.log(`\n=== Deployed ===`);
console.log(`  Function: ${FN} | Region: ${REGION} | Layer: ${layerArn}\n`);

// Cleanup
fs.rmSync(pkgDir, { recursive: true, force: true });
if (fs.existsSync(lambdaZip)) fs.unlinkSync(lambdaZip);
