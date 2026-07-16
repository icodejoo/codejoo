import { resolve, normalize } from 'path'
import { existsSync } from 'fs'
import type { Plugin } from 'vite'
import { defaultConfig, mergeConfig, loadConfigFile } from './config'
import { scanMockDir, loadMockFile } from '../core/loader'
import { buildHonoApp } from '../core/router'
import type { MockerConfig, LoadedRoute } from './types'

export interface MockOptions extends Partial<MockerConfig> {
  configFile?: string
}

export function mock(options?: MockOptions): Plugin {
  const routesByFile = new Map<string, LoadedRoute[]>()
  let honoApp: ReturnType<typeof buildHonoApp>
  let config: MockerConfig
  let absDir: string

  function rebuild() {
    honoApp = buildHonoApp(Array.from(routesByFile.values()).flat(), config)
    console.log('[mocker] Routes reloaded')
  }

  async function reloadFile(file: string) {
    if (!file.startsWith(absDir) || !file.endsWith('.ts')) return
    if (existsSync(file)) {
      const routes = await loadMockFile(file)
      // on parse error routes === [] but file still exists — preserve previous routes
      if (routes.length > 0) routesByFile.set(file, routes)
    } else {
      routesByFile.delete(file)
    }
    rebuild()
  }

  return {
    name: 'vite-plugin-mocker',
    apply: 'serve',

    async configureServer(server) {
      const { configFile, ...restOptions } = options ?? {}
      const fileConfig = configFile ? await loadConfigFile(configFile) : {}
      config = mergeConfig(mergeConfig(defaultConfig, fileConfig), restOptions)

      if (!config.enable) {
        console.log('[mocker] Disabled — all requests forwarded to Vite')
        return
      }

      absDir = normalize(resolve(config.dir))

      // Initial route load
      const files = await scanMockDir(config.dir)
      await Promise.all(files.map(async f => { routesByFile.set(f, await loadMockFile(f)) }))
      honoApp = buildHonoApp(Array.from(routesByFile.values()).flat(), config)

      // Reuse Vite's chokidar watcher — no duplicate process
      server.watcher.add(`${absDir}/**/*.ts`)
      server.watcher.on('change', reloadFile)
      server.watcher.on('add', reloadFile)
      server.watcher.on('unlink', reloadFile)

      // Connect middleware — runs before Vite's own handlers
      server.middlewares.use(async (req, res, next) => {
        if (!honoApp) { next(); return }

        try {
          const host = req.headers.host ?? 'localhost'
          const url = `http://${host}${req.url}`

          // Build Headers, flattening any multi-value entries
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) {
            if (v === undefined) continue
            headers.set(k, Array.isArray(v) ? v.join(', ') : v)
          }

          // Buffer the body (streaming not needed for a mock)
          let body: Buffer | undefined
          const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
          if (hasBody) {
            const chunks: Buffer[] = []
            for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk)
            if (chunks.length) body = Buffer.concat(chunks)
          }

          const request = new Request(url, { method: req.method, headers, body })
          const response = await honoApp.fetch(request)

          // No mock matched — let Vite handle it
          if (response.headers.get('x-mocker-miss')) { next(); return }

          res.statusCode = response.status
          response.headers.forEach((v, k) => { if (k !== 'x-mocker-miss') res.setHeader(k, v) })
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (err) {
          console.error('[mocker] Middleware error:', err)
          next()
        }
      })

      console.log(`[mocker] Vite plugin active — ${config.dir}`)
      if (config.fallback) console.log(`[mocker] Unmatched requests fallback to: ${config.fallback}`)
    },
  }
}
