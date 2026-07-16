import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: {
      'vite-plugin': 'tools/vite-plugin.ts',
      helpers: 'tools/helpers.ts',
    },
    format: 'esm',
    platform: 'node',
    target: 'node18',
    fixedExtension: true,
    dts: { tsgo: true },
    clean: true,
    deps: {
      neverBundle: ['hono', 'vite', 'chokidar'],
    },
  },
})
