import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: [
    {
      entry: 'src/index.ts',
      format: 'esm',
      platform: 'browser',
      target: 'es2015',
      fixedExtension: true,
      dts: { tsgo: true },
      clean: true,
      deps: {
        neverBundle: ['axios']
      }
    },
    {
      entry: 'src/index.ts',
      format: 'esm',
      platform: 'browser',
      target: 'es2015',
      minify: true,
      dts: false,
      clean: false,
      outExtensions: () => ({ js: '.min.js' }),
      // 注入生产标记，使 helper.ts 的 __DEV__ 折叠为 false，
      // 所有 if (__DEV__) {...} 调试日志块在 min 产物中被 DCE 掉。
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      deps: {
        neverBundle: ['axios']
      }
    }
  ]
})
