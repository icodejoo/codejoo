#!/bin/sh
# 在包目录执行：等 CPU 安静后，加锁跑正确性抽查（结果 results/verify.jsonl，截图 shots/）
cd "$(dirname "$0")/../.." || exit 1
powershell -NoProfile -File bench/2026-10-09-matrix/wait-idle.ps1 -Max 15 -Need 6 -TimeoutSec 600
PERF_SCRIPT="$PWD/bench/2026-10-09-matrix/verify-matrix.mjs" PERF_VIEWPORT=1200x800 node bench/kit/run-locked.mjs 9351 "C:/Users/jelon/AppData/Local/Temp/skz-matrix-chrome" bench/2026-10-09-matrix/scenarios/smoke.json http://localhost:5190/bench/2026-10-09-matrix/perf.html 1
