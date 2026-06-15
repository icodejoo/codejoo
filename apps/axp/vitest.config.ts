import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // 单元测试集中在 root/test 下，命名 *.test.ts（端到端 UI 测试见 e2e/）
        include: ['test/**/*.{test,spec}.ts'],
        // 关闭 console intercept，让 console.log 实时打印（即使测试通过也显示）
        disableConsoleIntercept: true,
        // 默认 verbose，列出每个 it 块
        reporters: ['verbose'],
    },
});
