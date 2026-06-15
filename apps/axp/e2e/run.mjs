// @ts-nocheck
/**
 * 端到端自动化：用真实 Playwright + 真实 Chromium 驱动演练场,逐项断言。
 *
 *   - 若 mock(:4570) 与 dev(:5180) 已在运行 → 复用(配合手动 `npm run e2e:server` + `npm run e2e:dev`)
 *   - 否则自动拉起两个服务,跑完再回收
 *
 * 每个 case 对应演练场上的一个按钮(= 一个公开 API 动作),37 个 case 覆盖 src 全部导出。
 * 任一断言失败 → 退出码 1。
 *
 * 运行：`npm run e2e`
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const MOCK = 'http://localhost:4570';
const APP = 'http://localhost:5180';
// e2e/ 目录(run.mjs 所在目录)
const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async (url) => { try { await fetch(url); return true; } catch { return false; } };
async function waitUp(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) { if (await up(url)) return; await sleep(500); }
  throw new Error(`${label} did not come up: ${url}`);
}

// ── assert helpers ───────────────────────────────────────────────────────────
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c, msg) => { if (!c) throw new Error(msg); };

/**
 * 每个 case：{ action(按钮 testid), result(结果面板 testid), exports(本 case 覆盖的导出), check(j) }
 */
const cases = [
  // ── Core verbs + 三态 ──
  { action: 'core-get', result: 'core-result', exports: ['create', 'Core', 'get'], check: (j) => eq(j.query.q, '1', 'get query') },
  { action: 'core-post', result: 'core-result', exports: ['post'], check: (j) => eq(j.body.name, 'x', 'post body') },
  { action: 'core-put', result: 'core-result', exports: ['put'], check: (j) => eq(j.body.v, 1, 'put body') },
  { action: 'core-patch', result: 'core-result', exports: ['patch'], check: (j) => eq(j.body.v, 2, 'patch body') },
  { action: 'core-delete', result: 'core-result', exports: ['delete'], check: (j) => eq(j.body.del, 1, 'delete body') },
  { action: 'core-head', result: 'core-result', exports: ['head'], check: (j) => eq(j.head, 'resolved', 'head') },
  { action: 'core-options', result: 'core-result', exports: ['options'], check: (j) => eq(j.options, 'resolved', 'options') },
  { action: 'core-plain', result: 'core-result', exports: ['plain shape'], check: (j) => eq(j.query.shape, 'plain', 'plain unwrap') },
  { action: 'core-raw', result: 'core-result', exports: ['raw shape'], check: (j) => ok(j.code === '0000' && j.data && 'message' in j, 'raw envelope') },
  { action: 'core-wrap', result: 'core-result', exports: ['wrap shape'], check: (j) => ok(j.__type === 'ApiResponse' && j.successful === true, 'wrap ApiResponse') },

  // ── lifecycle ──
  { action: 'lifecycle-use', result: 'lifecycle-result', exports: ['use'], check: (j) => eq(j.map((p) => p.name), ['logging', 'tracer'], 'use') },
  { action: 'lifecycle-eject', result: 'lifecycle-result', exports: ['eject'], check: (j) => eq(j.map((p) => p.name), ['tracer'], 'eject') },
  { action: 'lifecycle-plugins', result: 'lifecycle-result', exports: ['plugins'], check: (j) => eq(j.length, 2, 'plugins snapshot') },
  { action: 'lifecycle-extends', result: 'lifecycle-result', exports: ['extends'], check: (j) => { eq(j.parent, ['logging'], 'parent'); eq(j.child, ['logging', 'tracer'], 'child'); } },

  // ── buildKey / $key ──
  { action: 'buildkey-simple', result: 'buildkey-result', exports: ['$key (simple)'], check: (j) => ok(j.equal === true, 'simple ignores params') },
  { action: 'buildkey-deep', result: 'buildkey-result', exports: ['$key (deep)'], check: (j) => ok(j.equal === false, 'deep distinguishes params') },
  { action: 'buildkey-plugin', result: 'buildkey-result', exports: ['buildKey'], check: (j) => ok(typeof j.capturedKey === 'string' && j.capturedKey.includes('-'), 'buildKey writes 64-bit key') },

  // ── cache ──
  { action: 'cache-hit-twice', result: 'cache-result', exports: ['cache'], check: (j) => { eq(j.serverHits, 1, 'cache one network hit'); eq(j.r2.hits, 1, 'cache served second'); } },
  { action: 'cache-remove', result: 'cache-result', exports: ['removeCache'], check: (j) => { ok(j.removed === true, 'removed'); eq(j.serverHits, 2, 'refetch after remove'); } },
  { action: 'cache-clear', result: 'cache-result', exports: ['clearCache'], check: (j) => ok(j.cleared >= 1, 'clearCache count') },

  // ── share ──
  { action: 'share-start', result: 'share-result', exports: ['share (start)'], check: (j) => { eq(j.serverHits, 1, 'start merges'); ok(j.hitsSeen.every((h) => h === 1), 'all callers same'); } },
  { action: 'share-race', result: 'share-result', exports: ['share (race)'], check: (j) => eq(j.serverHits, 3, 'race each sends') },
  { action: 'share-end', result: 'share-result', exports: ['share (end)'], check: (j) => { eq(j.serverHits, 3, 'end each sends'); eq(j.sameResult, 1, 'end one result'); } },
  { action: 'share-retry', result: 'share-result', exports: ['share (retry)'], check: (j) => { eq(j.serverHits, 3, 'retry until success'); eq(j.result.hits, 3, 'retry final') } },

  // ── retry ──
  { action: 'retry-run', result: 'retry-result', exports: ['retry'], check: (j) => { eq(j.serverHits, 3, 'retry 3 hits'); eq(j.result.hits, 3, 'retry success'); } },
  { action: 'retry-disabled', result: 'retry-result', exports: ['retry:0'], check: (j) => { ok(j.rejected === true, 'retry:0 rejects'); eq(j.serverHits, 1, 'no retry'); } },

  // ── cancel ──
  { action: 'cancel-run', result: 'cancel-result', exports: ['cancel', 'cancelAll'], check: (j) => ok(j.canceled === true, 'cancelAll aborts') },

  // ── loading ──
  { action: 'loading-run', result: 'loading-result', exports: ['loading'], check: (j) => eq(j.toggles, [true, false], 'loading toggles once') },

  // ── mock ──
  { action: 'mock-run', result: 'mock-result', exports: ['mock'], check: (j) => ok(j.mocked === true && j.path.includes('/mock'), 'mock rewrite') },
  { action: 'mock-fallback', result: 'mock-result', exports: ['mock (fallback)'], check: (j) => { eq(j.path, '/api/echo', 'fell back to real'); eq(j.query.via, 'fallback', 'real request'); ok(!j.mocked, 'not from mock'); } },

  // ── envs ──
  { action: 'envs-run', result: 'envs-result', exports: ['envs'], check: (j) => { eq(j.baseURL, MOCK, 'baseURL unchanged'); eq(j.xEnv, 'prod', 'env header merged'); } },

  // ── filterRequest / normalizeRequest ──
  { action: 'filter-run', result: 'filter-result', exports: ['filterRequest', 'normalizeRequest'], check: (j) => { ok(j.aliasIsSame === true, 'alias'); eq(j.query.a, '1', 'keep a'); eq(j.query.e, '0', 'keep 0'); ok(!('b' in j.query) && !('c' in j.query) && !('d' in j.query), 'drop empties'); } },

  // ── replacePathVars ──
  { action: 'pathvars-run', result: 'pathvars-result', exports: ['replacePathVars'], check: (j) => eq(j.path, '/users/7/posts/9', 'path vars substituted') },

  // ── normalizeResponse ──
  { action: 'normalize-ok', result: 'normalize-result', exports: ['normalizeResponse (ok)'], check: (j) => eq(j.query.ok, '1', 'success passes through') },
  { action: 'normalize-fail', result: 'normalize-result', exports: ['normalizeResponse (fail)', 'ApiError'], check: (j) => { ok(j.rejected === true, 'rejects'); ok(j.isApiError === true, 'ApiError instance'); eq(j.response.code, '5001', 'carries ApiResponse'); } },

  // ── TokenManager ──
  { action: 'token-set', result: 'token-result', exports: ['TokenManager'], check: (j) => { eq(j.accessToken, 'Bearer abc', 'bearer prefix'); eq(j.refreshToken, 'refresh1', 'refresh'); } },
  { action: 'token-clear', result: 'token-result', exports: ['TokenManager.clear'], check: (j) => ok(!j.accessToken && !j.refreshToken, 'cleared') },

  // ── ApiResponse / ApiError ──
  { action: 'apiresponse-run', result: 'apiresponse-result', exports: ['ApiResponse'], check: (j) => { ok(j.okSuccessful === true, 'ok successful'); ok(j.nullSuccessful === true, 'null body no crash'); ok(j.errIsError === true, 'ApiError is Error'); ok(j.isCoreCtor === true, 'Core ctor'); } },
];

async function runCase(page, c) {
  await page.getByTestId(c.action).click();
  const pane = page.locator(`[data-testid="${c.result}"].ok, [data-testid="${c.result}"].err`).first();
  await pane.waitFor({ timeout: 15000 });
  const txt = await page.getByTestId(c.result).textContent();
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error(`result not JSON: ${txt?.slice(0, 120)}`); }
  c.check(j);
}

async function main() {
  const procs = [];
  const needMock = !(await up(MOCK + '/api/hits'));
  const needApp = !(await up(APP));
  if (needMock) procs.push(spawn(process.execPath, [`${ROOT}/server/mock-server.mjs`], { stdio: 'ignore' }));
  if (needApp) procs.push(spawn('npx', ['vp', 'dev', `${ROOT}/playground`, '--port', '5180', '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' }));
  console.log(`[e2e] mock:${needMock ? 'spawned' : 'reused'} app:${needApp ? 'spawned' : 'reused'}`);
  await waitUp(MOCK + '/api/hits', 'mock');
  await waitUp(APP, 'dev server');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });

  let pass = 0; const fails = []; const covered = new Set();
  for (const c of cases) {
    process.stdout.write(`• ${c.action} … `);
    try { await runCase(page, c); pass++; c.exports.forEach((e) => covered.add(e)); console.log('PASS'); }
    catch (e) { fails.push({ action: c.action, error: e.message }); console.log('FAIL — ' + e.message); }
  }

  await browser.close();
  for (const p of procs) { try { p.kill(); } catch {} }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`covered API actions: ${covered.size} | cases: ${pass}/${cases.length} passed`);
  if (consoleErrors.length) console.log(`page console errors: ${consoleErrors.length}\n  ` + consoleErrors.slice(0, 5).join('\n  '));
  if (fails.length) {
    console.log(`\nFAILURES:`); fails.forEach((f) => console.log(`  ✗ ${f.action}: ${f.error}`));
    process.exit(1);
  }
  if (consoleErrors.length) process.exit(1);
  console.log('ALL E2E PASSED ✅');
  process.exit(0);
}

main().catch((e) => { console.error('e2e runner crashed:', e); process.exit(1); });
