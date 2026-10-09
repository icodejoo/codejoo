K="C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad/bench-kit"
P="C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad/chrome-prof-a4"
cd /e/workspaces/codejoo/apps/skeletonizer/demo/.tmp-a4
node "$K/run-locked.mjs" 9344 "$P" sA2-n2000-rerun.json http://localhost:5188/demo/.tmp-a4/perf.html 3 > out-A2.txt 2> err-A2.txt
node "$K/run-locked.mjs" 9344 "$P" sC2-n2000-rerun.json http://localhost:5188/demo/.tmp-a4/perf-bone.html 3 > out-C-rerun.txt 2> err-C-rerun.txt
echo done > alldone3.txt
