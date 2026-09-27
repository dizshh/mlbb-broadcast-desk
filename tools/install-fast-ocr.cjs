// Bundle the small, integer LSTM model; clients need no external model download.
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');

(async () => {
  const base = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0';
  const dir = path.join(__dirname, '../public/ocr-models/fast');
  const response = await fetch(base + '/eng.traineddata', { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error('OCR model download HTTP ' + response.status);
  const model = Buffer.from(await response.arrayBuffer());
  if (model.length < 1000000) throw Error('Incomplete OCR model');
  const license = await fetch(base + '/LICENSE', { signal: AbortSignal.timeout(10000) });
  if (!license.ok) throw Error('Could not download the model license');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'eng.traineddata.gz'), gzipSync(model, { level: 9 }));
  fs.writeFileSync(path.join(dir, 'LICENSE'), await license.text());
  fs.writeFileSync(path.join(dir, 'SOURCE.md'), `# English fast LSTM model\n\nSource: ${base}/eng.traineddata\n\nSHA-256 (uncompressed): ${createHash('sha256').update(model).digest('hex')}\n\nLicense: Apache-2.0; see LICENSE.\n\nDownloaded by tools/install-fast-ocr.cjs. Used locally for frequent game HUD readings.\n`);
  console.log('Bundled fast English neural OCR model: ' + model.length + ' bytes');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
