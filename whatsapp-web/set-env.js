const fs = require('fs');
const env = process.argv[2]; // 'qa' or 'prod'

const source = env === 'qa' ? '.env.qa' : '.env.prod';

if (!fs.existsSync(source)) {
  console.error(`ERROR: ${source} not found.`);
  process.exit(1);
}

fs.copyFileSync(source, '.env');
console.log(`Copied ${source} to .env`);
