#!/bin/sh
# 补跑 scen-A 中因 perf.html 被重写而中断的后半部分
cd "$(dirname "$0")"
SP="C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad"
H=http://localhost:5188/demo/.tmp-a5
node run-locked-a5.mjs 9345 "$SP/chrome-prof-a5" trace-a5.mjs $H/perf.html scen-A-rest.json 3 > results/results-A-rest.jsonl 2> results/results-A-rest.err
echo done > results/A_REST_DONE
