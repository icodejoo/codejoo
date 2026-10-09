#!/bin/sh
# 等 run-all.sh 结束后：第二批截图 + 性能页滤镜有效性截图
cd "$(dirname "$0")"
while [ ! -f results/ALL_DONE ]; do sleep 5; done
SP="C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad"
H=http://localhost:5188/demo/.tmp-a5
node run-locked-a5.mjs 9345 "$SP/chrome-prof-a5" shot-a5-b.mjs $H/visual.html shots > results/shots-b.log 2> results/shots-b.err
node run-locked-a5.mjs 9345 "$SP/chrome-prof-a5" shot-a5-perf.mjs $H/perf.html shots > results/shots-perf.log 2> results/shots-perf.err
echo done > results/AFTER_DONE
