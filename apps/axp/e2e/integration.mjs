// @ts-nocheck
/**
 * 集成测试 UI 驱动：用真实 Chromium 打开演练场，逐个点按「集成测试」分区的按钮，
 * 读取结果面板里的 JSON 并校验 `pass===true`。
 *
 * 前置：mock(:4570) + playground(:5180) 已在运行（`npm run e2e:dev`）。
 * 运行：`node e2e/integration.mjs` —— 全 PASS 退出 0，否则 1。
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const APP = 'http://localhost:5180';
const MOCK = 'http://localhost:4570';
const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async (url) => { try { await fetch(url); return true; } catch { return false; } };
async function waitUp(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await up(url)) return;
    await sleep(500);
  }
  throw new Error(`${label} 未就绪: ${url}`);
}

// 复用已运行的服务，否则自动拉起（跑完回收）
const procs = [];
if (!(await up(MOCK + '/api/hits'))) procs.push(spawn(process.execPath, [`${ROOT}/server/mock-server.mjs`], { stdio: 'ignore' }));
if (!(await up(APP))) procs.push(spawn('npx', ['vp', 'dev', `${ROOT}/playground`, '--port', '5180', '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' }));
const cleanup = () => { for (const p of procs) { try { p.kill(); } catch {} } };
process.on('exit', cleanup);

const cases = [
  { btn: 'int-share-start', panel: 'int-share-result', name: 'share start 高并发去重' },
  { btn: 'int-race-run', panel: 'int-race-result', name: 'race 乱序夹错' },
  { btn: 'int-retry-recover', panel: 'int-retry-result', name: 'retry 恢复' },
  { btn: 'int-retry-exhaust', panel: 'int-retry-result', name: 'retry 耗尽（无限重试 bug 验证）' },
  { btn: 'int-crosstalk-run', panel: 'int-crosstalk-result', name: '20 并发乱序无串扰' },
  { btn: 'int-loading-run', panel: 'int-loading-result', name: 'loading 并发计数' },
  { btn: 'int-auth-run', panel: 'int-auth-result', name: 'auth 并发单飞刷新' },
  { btn: 'int-auth-fail-run', panel: 'int-auth-fail-result', name: 'auth 刷新失败' },
  { btn: 'int-auth-burst-run', panel: 'int-auth-burst-result', name: 'auth 时间线(慢成功/慢失败/刷新中发起)' },
  { btn: 'int-auth-bounded-run', panel: 'int-auth-bounded-result', name: 'auth 极端有界收敛（带当前 token 的 401）' },
];

await waitUp(MOCK + '/api/hits', 'mock');
await waitUp(APP, 'playground');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="int-auth-bounded-run"]', { timeout: 20000 });

let allPass = true;
console.log('\n── 集成测试 UI 用例 ──');
for (const c of cases) {
  const prev = await page.textContent(`[data-testid="${c.panel}"]`).catch(() => '');
  await page.click(`[data-testid="${c.btn}"]`);
  let obj, pass = false;
  try {
    const txt = await page.waitForFunction(
      ({ sel, prev }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const t = el.textContent || '';
        if (t === prev || t === 'running…' || t === '(尚未运行)') return false;
        return t;
      },
      { sel: `[data-testid="${c.panel}"]`, prev },
      { timeout: 25000 },
    ).then((h) => h.jsonValue());
    obj = JSON.parse(txt);
    pass = obj.pass === true;
  } catch (e) {
    obj = { error: String(e?.message || e) };
  }
  allPass = allPass && pass;
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'}  ${c.name}\n        ${JSON.stringify(obj)}`);
}

await browser.close();
console.log(allPass ? '\n✅ 集成 UI 用例全部通过\n' : '\n❌ 有用例失败\n');
process.exit(allPass ? 0 : 1);
