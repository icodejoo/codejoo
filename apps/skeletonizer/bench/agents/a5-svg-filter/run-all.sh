#!/bin/sh
# 依次：截图 -> 滤镜 A -> 滤镜 B/C -> 对照 prod -> 额外（半径/深色）。每步各自拿 bench-kit 的锁。
cd "$(dirname "$0")"
SP="C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad"
H=http://localhost:5188/demo/.tmp-a5
node run-locked-a5.mjs 9345 "$SP/chrome-prof-a5" shot-a5.mjs $H/visual.html shots > results/shots.log 2> results/shots.err
for s in A BC prod extra; do
  node run-locked-a5.mjs 9345 "$SP/chrome-prof-a5" trace-a5.mjs $H/perf.html scen-$s.json 3 > results/results-$s.jsonl 2> results/results-$s.err
done
echo done > results/ALL_DONE
