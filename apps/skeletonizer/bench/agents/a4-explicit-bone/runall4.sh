K="C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad/bench-kit"
P="C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad/chrome-prof-a4"
cd /e/workspaces/codejoo/apps/skeletonizer/demo/.tmp-a4
for s in shimmer leaf; do
node "$K/run-locked.mjs" 9344 "$P" sA3-$s-n2000.json http://localhost:5188/demo/.tmp-a4/perf.html 3 > out-A3-$s.txt 2> err-A3-$s.txt
done
echo done > alldone4.txt
