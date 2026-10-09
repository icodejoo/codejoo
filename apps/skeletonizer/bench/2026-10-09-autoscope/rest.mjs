// 断点续跑辅助：读场景文件和已有的日志，输出尚未完成的场景（按名字比对）到 stdout（JSON）。
// 用法：node rest.mjs <sc.json> <log>
import fs from "node:fs";
const [sc, log] = process.argv.slice(2);
const done = new Set(fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).name) : []);
console.log(JSON.stringify(JSON.parse(fs.readFileSync(sc, "utf8")).filter((s) => !done.has(s.name))));
