import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // 测试与源码同目录（co-located），命名 *.test.ts
        // 集成测试集中在 test/integration/ 下；test/*.test.ts 是顶层综合编排测试
        include: [
            'src/**/*.{test,spec}.ts',
            'test/integration/**/*.{test,spec}.ts',
            'test/*.{test,spec}.ts',
        ],
        // 集成测试需要起 Bun 子进程，给 hooks 留一点余量
        hookTimeout: 20_000,
        testTimeout: 20_000,
        // 关闭 console intercept，让 console.log 实时打印（即使测试通过也显示）
        disableConsoleIntercept: true,
        // 默认 verbose，列出每个 it 块
        reporters: ['verbose'],
    },
});
