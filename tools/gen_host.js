const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'manifest.json');
const hostJsonPath = path.join(root, 'host.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

let key = manifest.key;
if (!key) {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  manifest.key = key;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('generated new key, manifest updated');
}

const der = Buffer.from(key, 'base64');
const h = crypto.createHash('sha256').update(der).digest();
let id = '';
for (let i = 0; i < 16; i++) {
  id += String.fromCharCode(97 + (h[i] >> 4));
  id += String.fromCharCode(97 + (h[i] & 15));
}

const hostJson = {
  name: 'com.loopsloader.host',
  description: 'LoopsLoader native host: starts the local loop file server',
  path: path.join(root, 'host.bat'),
  type: 'stdio',
  allowed_origins: ['chrome-extension://' + id + '/']
};
fs.writeFileSync(hostJsonPath, JSON.stringify(hostJson, null, 2) + '\n');
console.log('extension ID : ' + id);
console.log('host.json    : ' + hostJsonPath);
console.log('allowed_origins: chrome-extension://' + id + '/');