---
title: axp 洋葱管线 B0 旧版性能、体积与行为基线
status: active
updated: 2026-10-28
summary: 记录 fe570bf 旧 API 的六场景性能、gzip -9 体积、测试行为清单与归档检查结果
---

## TL;DR

- 旧源码未改；基准使用 Axp.create/Axp.install 与旧插件工厂。
- 六场景独立连续测三轮，报告取吞吐中位数所在轮的完整记录；最大吞吐波动 8.16%。
- 单包 39,174 字节，gzip -9 为 13,080；33 个 ESM 合计 190,097 / 78,283 字节。
- 实际 836 处声明完整登记为 346 keep、423 change、67 drop；822 漏计了 14 处双引号标题。
- 旧测试已归档；零用例和 tsgo 通过，全量 vp check 存在旧源码及执行器的既有问题，未通过。

## 环境与版本

| 项目               | 实测值                                               |
| ------------------ | ---------------------------------------------------- |
| 仓库/分支/基准提交 | codejoo / jelon/axp-pipeline / fe570bf               |
| 包                 | @codejoo/axp 0.2.0                                   |
| CPU                | 13th Gen Intel(R) Core(TM) i5-13500，20 个逻辑处理器 |
| 内存               | 34,033,348,608 字节（约 31.70 GiB）                  |
| OS                 | Windows_NT 10.0.19045 x64                            |
| Node               | v24.11.0                                             |
| 测量器             | vp test/0.1.22 自带 bench，未新增依赖                |
| 时区/日期          | Asia/Shanghai / 2026-10-28                           |

测量对象是此分支的重构前源码，未切换 main；fe570bf 只添加了覆盖率依赖。工作期间 implementation-plan/test-plan 的覆盖率门槛有外部修改，原样保留，不计入本批产出。

## T1 性能

使用 [pipeline.bench.ts](../../bench/pipeline.bench.ts)。adapter 立即 `Promise.resolve` 一个新的 200 信封 `{ code: 0, data: { value: 1 } }`，保留实际 config；不用 `makeNetwork()`，因为后者即使延迟为 0 仍有 setTimeout、路由表、计数表与调用流水开销。各场景共用同一个薄 adapter；仅保留一个 sends 自增计数，用于测量外自检。

每轮每场景预热 500ms，正式测量至少 2000ms、至少 100 个样本。最终版连续独立跑 **3 轮**，没有并行构建、lint 或 tsgo。稳定性口径：三轮 hz 的最大/最小差小于 10%，每轮 RME 小于 5%；实际最差分别为 8.16%、3.48%。早先用于调试回调类型/场景的运行不参与中位数，原始结果已被最终三轮覆盖。

表中 hz、mean、p99、样本数来自**同一轮**：按 hz 排序选中位轮，避免把不同轮的指标拼在一起。mean/p99 单位 ms；B5 的一次操作是一整组 100 个请求，hz 是组/秒，样本数是组数。

| 场景                     |        hz | mean (ms) | p99 (ms) |  样本数 | 中位轮 |
| ------------------------ | --------: | --------: | -------: | ------: | -----: |
| B1 裸 axios              | 76,462.49 |  0.013078 | 0.031200 | 152,925 |      1 |
| B2 axp 无插件            | 79,863.67 |  0.012521 | 0.030300 | 159,728 |      2 |
| B3 全插件，缓存未命中    | 14,986.99 |  0.066725 | 0.189600 |  29,974 |      2 |
| B4 缓存命中              | 75,090.82 |  0.013317 | 0.032000 | 150,182 |      1 |
| B5 share start，并发 100 |    743.91 |  1.344241 | 3.090500 |   1,488 |      1 |
| B6 JSON POST + retry     | 57,600.58 |  0.017361 | 0.041600 | 115,202 |      3 |

原始结果：[第 1 轮](../../bench/run-1.json)、[第 2 轮](../../bench/run-2.json)、[第 3 轮](../../bench/run-3.json)。JSON 的 sampleCount 是采样数；samples 数组由 runner 省略，不据此判断样本为零。

| 场景 | 三轮 hz 最大/最小差 | 最大 RME |
| ---- | ------------------: | -------: |
| B1   |               0.33% |    0.34% |
| B2   |               3.76% |    0.43% |
| B3   |               8.16% |    3.48% |
| B4   |               3.62% |    0.62% |
| B5   |               3.35% |    1.67% |
| B6   |               4.04% |    1.07% |

B3 安装 key、filter、repath、cancel、auth、retry、notify、normalize、loading、share、cache；`fastMode:false` 配合每次递增的 params，防止旧 `key:true` 的简单模式串缓存。auth 已有 token，retry max=2，但均不触发恢复。B4 使用显式固定 key 和 Infinity TTL，预先填充；B5 使用同一 key，等待整组完成才开下一组；B6 每次新建 JSON body，只装 retry。正式测量前自检 B3 两次请求均触网、B4 命中零触网、B5 一组只触网一次。

B2 比 B1 略快：裸 axios.get 与 Core 的 axios.request 分发路径不同，JIT/调用顺序也会影响微秒级数据，不能据差值声称包装具有负开销。后续比较应沿用本文件的相同路径、机器和测量口径。B3 mean 减 B1 mean 约 0.053647ms，是后续额外开销比较的参照。

## T2 体积

`vp pack` 成功后，使用 Git Bash 的 gzip -9 实测；未使用构建日志里自带的 gzip 估算。

| 产物               | 文件数 | 原始字节 | gzip -9 字节 |
| ------------------ | -----: | -------: | -----------: |
| dist/index.min.js  |      1 |   39,174 |       13,080 |
| dist/esm/\*_/_.mjs |     33 |  190,097 |       78,283 |

ESM 为递归查找全部 .mjs 后，逐个 `gzip -9 -c "$f" | wc -c` 再累加，不是合并源码后压缩；含 gzip 的逐文件头部，不包含 .d.mts、map 或压缩单包。构建出现旧 normalize 相对模块声明的提示，未影响成功。

## 旧测试、覆盖率与行为清单

沿用主会话 2026-10-28 已知实测：90 个文件、展开执行 **1002 条，全部通过**；覆盖率语句 90.5%、分支 94.15%、函数 85.83%、行 91.67%。本批没有重新执行旧测试或覆盖率。

给定的 822 处声明经静态核对需要修正：759 处单引号 it + 62 处 it.each + 1 处无插值模板字符串 it = 822，另有 14 处双引号 it，总数 **836**。语法树同时解析 each 数组、展开元素及常量拼接标题，展开计数恰好 1002。完整位置及漏记清单见 [行为总表](../reference/pipeline-migration/README.md)。

| 层          | keep | change | drop | 声明数 | 展开数 |
| ----------- | ---: | -----: | ---: | -----: | -----: |
| unit        |  141 |     77 |    9 |    227 |    268 |
| rule        |  107 |    133 |   14 |    254 |    279 |
| boundary    |   78 |    173 |   27 |    278 |    358 |
| combo       |   15 |     18 |    0 |     33 |     37 |
| integration |    5 |     22 |   17 |     44 |     60 |
| 合计        |  346 |    423 |   67 |    836 |   1002 |

核对：`836 = 346 + 423 + 67`，`1002 = 836 + 166`，`822 + 14 = 836`。原 822 口径也核对为 `822 = 334 keep + 421 change + 67 drop`；补记 14 行为 12 keep、2 change，未删行凑数。40 处存疑行均暂倾向 change，完整旧位置、理由和计划新位置已列于总表和各层明细。

## T4 归档与检查

90 个文件由 test/{unit,rule,boundary,combo,integration} 移至 test/legacy/ 对应子目录。git mv 因 .git/index.lock 写入受限失败，使用普通移动；由提交者让 git 识别重命名。只调整 src、types、e2e、helpers 的相对路径；helpers 原位保留。

vitest 排除 test/legacy/**，暂加 passWithNoTests:true；**B1 加入新用例后移除\*\*。tsconfig 排除 legacy，新增 bench 类型检查。accept/tsconfig 只包含自身目录及 types，不会纳入 legacy。格式化与 lint 配置也排除 legacy，避免旧断言格式变化和后续类型分析重新纳入归档。

| 检查                           | 结果                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| vp pack                        | 退出码 0                                                                                            |
| 最终三轮 vp test bench --run   | 全部退出码 0，场景自检通过                                                                          |
| vp test --run                  | 零用例，退出码 0                                                                                    |
| tsgo --noEmit -p tsconfig.json | 退出码 0，含 bench                                                                                  |
| vp check                       | 退出码 1；178 个文件的原有格式问题涉及 src、accept、e2e、legacy 等，禁止改 src 的约束下未全仓格式化 |
| vp check --no-fmt              | 未通过，4 个原有 lint 错误：src/core.ts 两处、accept/lib/expect.ts 一处、accept/lib/runner.ts 一处  |
| 文档索引检查                   | 收尾命令与结果见下文                                                                                |

## 复跑命令

在 apps/axp 下：

```powershell
npm run bench -- --outputJson bench/run-1.json
npm run bench -- --outputJson bench/run-2.json
npm run bench -- --outputJson bench/run-3.json
vp pack
vp test --run
node ../../node_modules/@typescript/native-preview/bin/tsgo.js --noEmit -p tsconfig.json
vp check
```

体积（Git Bash，当前目录 apps/axp）：

```bash
wc -c < dist/index.min.js
gzip -9 -c dist/index.min.js | wc -c
find dist/esm -type f -name '*.mjs' -print0 | xargs -0 wc -c | tail -1
total=0
while IFS= read -r -d '' f; do
  n=$(gzip -9 -c "$f" | wc -c)
  total=$((total+n))
done < <(find dist/esm -type f -name '*.mjs' -print0)
echo "$total"
```

在仓库根目录：

```powershell
python "$HOME/.claude/skills/docs-index/scripts/check_docs.py" apps/axp/docs
```

## 方案缺口与批次边界

- 声明基数应改为 836；完整去向表位于 reference/pipeline-migration/，与旧实施计划的单文件路径不同，按本次任务指定路径交付。
- plugin-spec §0 泛称请求选项不接受函数，但 §2.1 明确保留 loading 函数回调；应写清这是回调而非动态选项工厂。
- 插件级 enable（mock 以外）、nullable、purge/link/unlink、storage/memory、mock 对象内 mock 字段的迁移范围未全部列明。
- 并发 loading 的不同回调配对、缺少 structuredClone 的重放行为、max=0、未安装缓存的工具返回值、delay/jitter 抛错契约需要补充，已逐行标疑。
- B0 不执行 B1 的内核分支 100% 门槛，也不执行 B5 的全局覆盖率门槛；新源码尚未存在。
