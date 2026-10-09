#!/bin/bash
# 依次跑若干组场景，每组一次 run-locked（独立 Chrome），每个场景内部 3 次 trace 取中位数。
# 带看门狗与断点续跑：单组运行超过 WATCH 秒（默认 300）视为卡死，杀掉 trace / Chrome、清锁，
# 只重跑还没出结果的场景并追加到同一份日志（最多 6 次）。卡死情况记在 results/watchdog.log。
# 用法：bash run-all.sh <轮次名> <组顺序，如 "A B C D E"> <Chrome 配置目录>
# 在包目录（skeletonizer）下执行；原始输出落到 results/<轮次名>-<组>.log
ROUND=$1; ORDER=$2; PROFILE=$3; WATCH=${WATCH:-300}; PORT=9334
HERE=bench/2026-10-09-autoscope
cleanup() {
  powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*kit\trace.mjs*autoscope*' -or \$_.CommandLine -like '*kit/run-locked.mjs*autoscope*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" > /dev/null 2>&1
  powershell -NoProfile -File bench/kit/kill-chrome.ps1 -Port $PORT > /dev/null 2>&1
  rm -rf bench/kit/bench.lock
}
for g in $ORDER; do
  LOG=$HERE/results/$ROUND-$g.log; : > $LOG; : > $HERE/results/$ROUND-$g.err
  for try in 1 2 3 4 5 6; do
    node $HERE/rest.mjs $HERE/sc-$g.json $LOG > $HERE/results/.rest-$g.json
    [ "$(cat $HERE/results/.rest-$g.json)" = "[]" ] && break
    timeout $WATCH node bench/kit/run-locked.mjs $PORT "$PROFILE" $HERE/results/.rest-$g.json "http://localhost:5188/$HERE/perf-auto.html" 3 >> $LOG 2>> $HERE/results/$ROUND-$g.err
    cleanup
    echo "[watchdog] $ROUND-$g 第 $try 次结束，已有 $(wc -l < $LOG) 行" >> $HERE/results/watchdog.log
  done
done
rm -f $HERE/results/.rest-*.json
echo done > $HERE/results/$ROUND.done
