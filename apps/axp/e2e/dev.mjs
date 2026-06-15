// @ts-nocheck
/**
 * 一条命令同时拉起 mock 后端(:4570) + 演练场(:5180),供手动测试。
 *   npm run e2e:dev   → 浏览器打开 http://localhost:5180 逐项点按
 * Ctrl+C 同时回收两个子进程。
 */
import { spawn } from 'node:child_process';

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const isWin = process.platform === 'win32';

const procs = [
  { name: 'mock', color: '\x1b[36m', cmd: process.execPath, args: [`${ROOT}/server/mock-server.mjs`] },
  { name: 'play', color: '\x1b[35m', cmd: 'npx', args: ['vp', 'dev', `${ROOT}/playground`, '--port', '5180', '--strictPort'] },
].map(({ name, color, cmd, args }) => {
  const child = spawn(cmd, args, { shell: isWin, env: process.env });
  const tag = `${color}[${name}]\x1b[0m `;
  const pipe = (stream) => stream.on('data', (d) => process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => tag + l).join('\n') + '\n'));
  pipe(child.stdout); pipe(child.stderr);
  child.on('exit', (code) => { console.log(`${tag}exited (${code}); shutting down`); shutdown(); });
  return child;
});

let down = false;
function shutdown() {
  if (down) return; down = true;
  for (const c of procs) { try { c.kill(); } catch {} }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('\x1b[32m[e2e:dev]\x1b[0m mock → http://localhost:4570  ·  playground → http://localhost:5180  (Ctrl+C 退出)');
