const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8977;
const LOOPS_DIR = process.env.LOOPS_DIR || 'C:\\Users\\Vitali\\Downloads\\AIMusicTools\\Loops';

const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.ogg', '.opus', '.webm', '.m4a', '.aac', '.aiff']);

const MIME = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.aiff': 'audio/aiff'
};

function walk(dir, base, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const en of entries) {
    if (/^\./.test(en.name)) continue;
    const full = path.join(dir, en.name);
    const rel = path.join(base, en.name).replace(/\\/g, '/');
    if (en.isDirectory()) {
      walk(full, rel, out);
    } else if (en.isFile() && AUDIO_EXT.has(path.extname(en.name).toLowerCase())) {
      try {
        out.push({ name: rel, size: fs.statSync(full).size });
      } catch (e) {}
    }
  }
}

function listLoops() {
  const out = [];
  walk(LOOPS_DIR, '', out);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const u = new URL(req.url, 'http://127.0.0.1:' + PORT);
  if (u.pathname === '/api/loops') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, loops: listLoops() }));
    return;
  }
  if (u.pathname.startsWith('/loop/')) {
    try {
      const rel = decodeURIComponent(u.pathname.slice('/loop/'.length)).replace(/\\/g, '/');
      if (!rel || rel.split('/').includes('..') || path.isAbsolute(rel)) {
        res.writeHead(400);
        res.end('bad path');
        return;
      }
      const full = path.resolve(LOOPS_DIR, rel);
      if (!full.startsWith(path.resolve(LOOPS_DIR))) {
        res.writeHead(400);
        res.end('bad path');
        return;
      }
      if (!fs.existsSync(full)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    } catch (e) {
      res.writeHead(400);
      res.end('bad request');
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log('LoopsLoader server: http://127.0.0.1:' + PORT);
  console.log('Loops dir: ' + LOOPS_DIR);
  console.log('Press Ctrl+C to stop');
});