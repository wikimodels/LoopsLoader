const { spawn } = require('child_process');
const ROOT = __dirname;

let buf = Buffer.alloc(0);

function send(msg) {
  try {
    const data = Buffer.from(JSON.stringify(msg), 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(data.length, 0);
    process.stdout.write(Buffer.concat([len, data]));
  } catch (e) {}
}

process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    if (buf.length < 4) return;
    const n = buf.readUInt32LE(0);
    if (buf.length < 4 + n) return;
    const payload = buf.slice(4, 4 + n).toString('utf8');
    buf = buf.slice(4 + n);
    let msg = null;
    try {
      msg = JSON.parse(payload);
    } catch (e) {}
    if (msg && msg.type === 'start') {
      try {
        const child = spawn('node', ['server.js'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
        send({ ok: true, started: true });
      } catch (e) {
        send({ ok: false, error: e.message || String(e) });
      }
    } else {
      send({ ok: false, error: 'unknown message type' });
    }
  }
});

process.stdin.on('end', () => process.exit(0));