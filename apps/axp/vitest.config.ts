import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 单元测试集中在 root/test 下，命名 *.test.ts（端到端 UI 测试见 e2e/）
    include: ["test/**/*.{test,spec}.ts"],
    // 旧架构测试仅供迁移审计，B1 加入新用例后移除空集放行。
    exclude: ["test/legacy/**"],
    // B1 起只对内核四个文件启用分支满覆盖门槛。
    coverage: {
      provider: "v8",
      include: ["src/{client,pipeline,context,transport,response,key}.ts"],
      thresholds: { "src/{pipeline,context,transport,response}.ts": { branches: 100 } },
    },
    // 关闭 console intercept，让 console.log 实时打印（即使测试通过也显示）
    disableConsoleIntercept: true,
    // 默认 verbose，列出每个 it 块
    reporters: ["verbose"],
  },
});
