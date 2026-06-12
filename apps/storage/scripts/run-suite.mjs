// 临时脚本：无头跑 test/index.html 自动套件，打印结果（供 CI/agent 验证用）
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:5173/test/";
const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => !document.getElementById("summary")?.textContent?.includes("Running"), { timeout: 30000 });
const summary = await page.textContent("#summary");
const failures = await page.$$eval("td.name.fail", (tds) => tds.map((td) => `${td.textContent} | ${td.nextElementSibling?.textContent ?? ""}`));
console.log("SUMMARY:", summary?.trim());
for (const f of failures) console.log("FAIL:", f);
await browser.close();
process.exit(failures.length ? 1 : 0);
