K="C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad/bench-kit"
P="C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad/chrome-prof-a4"
cd /e/workspaces/codejoo/apps/skeletonizer/demo/.tmp-a4
for x in A:perf B:perf-bone C:perf-bone; do
 s=${x%%:*}; p=${x##*:}
 node "$K/run-locked.mjs" 9344 "$P" s$s.json http://localhost:5188/demo/.tmp-a4/$p.html 3 > out-$s.txt 2> err-$s.txt
done
echo done > alldone.txt
