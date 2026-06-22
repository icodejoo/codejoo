// 合成「等价类型内容、仅形态不同」的工程，供 tsserver/tsc 内存基准对比。
// 形态忠实于 typescript-emitter 的产物：response/request/paths 三个 .d.ts。
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const METHODS = ["get", "post", "put", "delete"];

/** opts: { wrap:'global'|'module', decl:'interface'|'type', index:'both'|'methodOnly'|'pathOnly',
 *          union:boolean, res,req,paths,filler,lookup } */
export function generate(outDir, opts = {}) {
  const c = { wrap: "global", decl: "interface", index: "both", union: true, res: 220, req: 120, paths: 240, filler: 25, lookup: 240, ...opts };
  const mod = c.wrap === "module";
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // 一个类型声明（无 export / 无缩进），decl 决定 interface 还是 type 别名
  const decl = (name, body) => (c.decl === "type" ? `type ${name} = {\n${body}}\n` : `interface ${name} {\n${body}}\n`);
  const resBody = (k, ref) =>
    `  id?: number\n  name?: string\n  active?: boolean\n  status?: 'a' | 'b' | 'c'\n` +
    `  self?: ${ref("Res" + k)}\n  prev?: ${ref("Res" + ((k - 1 + c.res) % c.res))}\n` +
    `  items?: Array<${ref("Res" + ((k + 1) % c.res))}>\n` +
    `  meta?: { x?: string; y?: number; z?: ${ref("Res" + ((k + 2) % c.res))} }\n`;
  const reqBody = (k, ref) => `  q?: string\n  page?: number\n  filter?: ${ref("Res" + (k % c.res))}\n  tags?: Array<string>\n`;

  const ops = [];
  for (let i = 0; i < c.paths; i++) ops.push({ p: "/p" + i, m: METHODS[i % 4], res: i % c.res, req: i % c.req });

  // 索引块（response ref 两模式都写 model.X；request ref：全局 model.req.X / 模块 req.X）
  const refRes = (n) => `model.${n}`;
  const refReq = (n) => (mod ? `req.${n}` : `model.req.${n}`);
  const entry = (o) => `[response: ${refRes("Res" + o.res)}, request: [payload: ${refReq("Req" + o.req)}]]`;
  let pathRefs = "";
  for (const o of ops) pathRefs += `  '${o.p}': {\n    ${o.m}: ${entry(o)}\n  }\n`;
  let methodRefs = "";
  for (const m of METHODS) { methodRefs += `  ${m}: {\n`; for (const o of ops) if (o.m === m) methodRefs += `    '${o.p}': ${entry(o)}\n`; methodRefs += `  }\n`; }
  const unionTxt = ops.map((o) => `  | '${o.p}'`).join("\n");

  const indent = (t, pad = "  ") => t.split("\n").map((l) => (l ? pad + l : l)).join("\n");

  if (mod) {
    let resF = "";
    for (let k = 0; k < c.res; k++) resF += "export " + decl("Res" + k, resBody(k, (n) => n)); // 同模块裸引用
    writeFileSync(`${outDir}/response.d.ts`, resF);
    let reqF = `import type * as model from './response'\n\n`;
    for (let k = 0; k < c.req; k++) reqF += "export " + decl("Req" + k, reqBody(k, (n) => "model." + n));
    writeFileSync(`${outDir}/request.d.ts`, reqF);
    let p = `import type * as model from './response'\nimport type * as req from './request'\n\n`;
    if (c.union) p += `export type Paths =\n${unionTxt}\n\n`;
    if (c.index !== "methodOnly") p += `export interface PathRefs {\n${pathRefs}}\n\n`;
    if (c.index !== "pathOnly") p += `export interface MethodRefs {\n${methodRefs}}\n`;
    writeFileSync(`${outDir}/paths.d.ts`, p);
  } else {
    let resF = "declare namespace model {\n";
    for (let k = 0; k < c.res; k++) resF += indent(decl("Res" + k, resBody(k, (n) => "model." + n))) + "\n";
    resF += "}\n";
    writeFileSync(`${outDir}/response.d.ts`, resF.replace(/\n\n}/, "\n}"));
    let reqF = "declare namespace model.req {\n";
    for (let k = 0; k < c.req; k++) reqF += indent(decl("Req" + k, reqBody(k, (n) => "model." + n))) + "\n";
    reqF += "}\n";
    writeFileSync(`${outDir}/request.d.ts`, reqF.replace(/\n\n}/, "\n}"));
    let inner = "";
    if (c.union) inner += `  type Paths =\n${indent(unionTxt)}\n\n`;
    if (c.index !== "methodOnly") inner += `  interface PathRefs {\n${indent(pathRefs)}  }\n\n`;
    if (c.index !== "pathOnly") inner += `  interface MethodRefs {\n${indent(methodRefs)}  }\n`;
    writeFileSync(`${outDir}/paths.d.ts`, `declare namespace model {\n${inner}}\n`);
  }

  // consumer：大量索引访问 + 模型变量 + 泛型查表（逼真模拟使用，强制 checker 解析）
  const imp = mod ? `import type { MethodRefs } from './paths'\nimport type {${Array.from({ length: Math.ceil(c.res / 3) }, (_, i) => "Res" + i * 3).join(", ")}} from './response'\n` : "";
  const MR = mod ? "MethodRefs" : "model.MethodRefs";
  const RES = (k) => (mod ? `Res${k}` : `model.Res${k}`);
  let cons = imp;
  for (let i = 0; i < c.lookup; i++) cons += `type L${i} = ${MR}['${METHODS[i % 4]}']['/p${i % c.paths}'][0]\n`;
  for (let k = 0; k < c.res; k += 3) cons += `declare const r${k}: ${RES(k)}\n`;
  cons += `declare function pick<M extends keyof ${MR}, P extends keyof ${MR}[M]>(m: M, p: P): ${MR}[M][P]\n`;
  for (let i = 0; i < c.lookup; i++) cons += `const u${i} = pick('${METHODS[i % 4]}', '/p${i % c.paths}')\n`;
  cons += "export {}\n";
  writeFileSync(`${outDir}/consumer.ts`, cons);

  for (let f = 0; f < c.filler; f++) writeFileSync(`${outDir}/filler${f}.ts`, `export const v${f} = ${f}\nexport function fn${f}(a: number) { return a + ${f} }\n`);
  writeFileSync(`${outDir}/tsconfig.json`, JSON.stringify({ compilerOptions: { noEmit: true, strict: true, skipLibCheck: true, moduleResolution: "bundler", module: "esnext", target: "es2022", types: [], lib: ["es2022"] }, include: ["**/*.ts"] }, null, 2));
}
