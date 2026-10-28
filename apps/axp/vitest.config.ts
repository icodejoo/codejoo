import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 单元测试集中在 root/test 下，命名 *.test.ts（端到端 UI 测试见 e2e/）
    include: ["test/**/*.{test,spec}.ts"],
    // 覆盖率范围与门槛见 docs/design/test-plan.md §7.1；不达标即失败。
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // 纯类型文件没有运行时代码，不计入覆盖率。
      exclude: ["src/types.ts", "src/**/*.d.ts"],
      thresholds: {
        lines: 95,
        branches: 90,
        functions: 95,
        // 内核四文件承载整条链的落定，分支必须满覆盖。
        "src/{pipeline,context,response,transport}.ts": { branches: 100 },
      },
    },
    // 关闭 console intercept，让 console.log 实时打印（即使测试通过也显示）
    disableConsoleIntercept: true,
    // 默认 verbose，列出每个 it 块
    reporters: ["verbose"],
  },
});
