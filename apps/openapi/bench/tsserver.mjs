// 真实 tsserver 内存基准（Windows）：分别打开 global / module 工程的 consumer，
// 触发语义检查后读 tsserver 进程 WorkingSet64。运行：node bench/tsserver.mjs
import { generate } from "./generate.mjs";
import { spawn, execSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

function findLib(name) {
  const pnpm = join(repoRoot, "node_modules", ".pnpm");
  for (const d of existsSync(pnpm) ? readdirSync(pnpm).filter((x) => x.startsWith("typescript@")) : []) {
    const cand = join(pnpm, d, "node_modules", "typescript", "lib", name);
    if (existsSync(cand)) return cand;
  }
  const direct = join(repoRoot, "node_modules", "typescript", "lib", name);
  if (existsSync(direct)) return direct;
  throw new Error(name + " not found");
}
const TSSERVER = findLib("tsserver.js");

function probe(file) {
  return new Promise((resolve) => {
    const srv = spawn(process.execPath, [TSSERVER], { stdio: ["pipe", "pipe", "ignore"] });
    let seq = 1;
    const send = (m) => srv.stdin.write(JSON.stringify(m) + "\n");
    send({ seq: seq++, type: "request", command: "open", arguments: { file } });
    send({ seq: seq++, type: "request", command: "geterr", arguments: { files: [file], delay: 0 } });
    send({ seq: seq++, type: "request", command: "semanticDiagnosticsSync", arguments: { file } });
    setTimeout(() => {
      let peak = 0;
      for (let i = 0; i < 3; i++) {
        try {
          const ws = Number(execSync(`powershell -NoProfile -Command "(Get-Process -Id ${srv.pid}).WorkingSet64"`).toString().trim());
          if (ws > peak) peak = ws;
        } catch {}
      }
      srv.kill();
      resolve(peak / 1048576);
    }, 7000);
  });
}

const base = join(tmpdir(), "axp-bench-tss");
for (const wrap of ["global", "module"]) {
  const dir = join(base, wrap);
  generate(dir, { wrap, decl: "interface" });
  const mb = await probe(join(dir, "consumer.ts"));
  console.log(`${wrap.padEnd(8)} tsserver WorkingSet = ${mb.toFixed(1)} MB`);
}
