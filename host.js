const { spawn, exec } = require('child_process');
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

/** Kill stray node.exe processes running our server.js (skip self). */
function cleanupStrays(cb) {
  const script = `
$killed = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -match 'server\\.js' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId })
@{ killed = $killed } | ConvertTo-Json -Compress
`;
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  pendingOps++;
  exec('powershell -NoProfile -EncodedCommand ' + b64, { windowsHide: true }, (err, stdout) => {
    pendingOps--;
    if (err) return finishOp({ ok: false, error: err.message }, cb);
    let killed = [];
    try {
      const m = (stdout || '').match(/\{.*\}/);
      killed = (JSON.parse(m ? m[0] : '{}') || {}).killed || [];
    } catch (_) {}
    finishOp({ ok: true, killed: [].concat(killed).filter(Boolean) }, cb);
  });
}

// ── Lifecycle: не выходим, пока есть незавершённые асинхронные операции ──────
let pendingOps = 0;
let stdinEnded = false;
const HOST_MAX_LIFETIME_MS = 60000;

function finishOp(result, cb) {
  try { cb(result); } catch (_) {}
  maybeExit();
}

function maybeExit() {
  if (stdinEnded && pendingOps === 0) {
    // даём stdout буферу записаться
    setTimeout(() => process.exit(0), 100);
  }
}

process.stdin.on('end', () => {
  stdinEnded = true;
  maybeExit();
});

setTimeout(() => process.exit(0), HOST_MAX_LIFETIME_MS).unref();

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
    if (!msg) continue;
    if (msg.type === 'start') {
      try {
        // use current node executable (not reliant on PATH when Chrome spawns host)
        const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
        send({ ok: true, started: true, pid: child.pid });
        maybeExit();
      } catch (e) {
        send({ ok: false, error: e.message || String(e) });
        maybeExit();
      }
    } else if (msg.type === 'cleanup') {
      cleanupStrays((r) => send(r));
    } else {
      send({ ok: false, error: 'unknown message type' });
      maybeExit();
    }
  }
});