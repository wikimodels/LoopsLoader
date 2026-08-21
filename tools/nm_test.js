const { spawn } = require('child_process');
const fs = require('fs');

function test(type, maxMs) {
  return new Promise((resolve) => {
    const msg = Buffer.from(JSON.stringify({ type }), 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(msg.length, 0);
    const ch = spawn('node', ['host.js'], { cwd: 'D:\\GitHub\\LoopsLoader', stdio: ['pipe', 'pipe', 'pipe'] });
    let out = Buffer.alloc(0);
    let done = false;
    const t0 = Date.now();
    const finish = () => {
      if (done) return;
      done = true;
      let r = 'TIMEOUT ' + type + ' bytes=' + out.length;
      if (out.length >= 4) {
        const n = out.readUInt32LE(0);
        r = out.slice(4, 4 + n).toString('utf8') + ' (after ' + (Date.now() - t0) + 'ms)';
      }
      try { ch.kill(); } catch (_) {}
      resolve(r);
    };
    ch.stdout.on('data', d => {
      out = Buffer.concat([out, d]);
      if (out.length >= 4 && out.length >= 4 + out.readUInt32LE(0)) finish();
    });
    ch.stdin.write(Buffer.concat([len, msg]));
    ch.stdin.end();
    setTimeout(finish, maxMs);
  });
}

(async () => {
  const a = await test('cleanup', 12000);
  fs.writeFileSync('D:\\GitHub\\LoopsLoader\\tools\\nm_test_result.txt', 'CLEANUP: ' + a + '\n');
  const b = await test('start', 5000);
  fs.appendFileSync('D:\\GitHub\\LoopsLoader\\tools\\nm_test_result.txt', 'START: ' + b + '\n');
  process.exit(0);
})();
