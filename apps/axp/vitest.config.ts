import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // 测试与源码同目录（co-located），命名 *.test.ts
        include: ['src/**/*.{test,spec}.ts'],
        // 关闭 console intercept，让 console.log 实时打印（即使测试通过也显示）
        disableConsoleIntercept: true,
        // 默认 verbose，列出每个 it 块
        reporters: ['verbose'],
    },
});
