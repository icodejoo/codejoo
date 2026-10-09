K="C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad/bench-kit"
P="C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad/chrome-prof-a4"
cd /e/workspaces/codejoo/apps/skeletonizer/demo/.tmp-a4
node "$K/run-locked.mjs" 9344 "$P" sB2-n2000.json http://localhost:5188/demo/.tmp-a4/perf-bone.html 3 > out-B2.txt 2> err-B2.txt
node run-shot.mjs 9345 "C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad/chrome-prof-a4s" > out-shot.txt 2> err-shot.txt
echo done > alldone2.txt
