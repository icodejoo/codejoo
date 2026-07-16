import { existsSync } from 'fs'
import { scanMockDir, loadMockFile } from './loader'
import { buildHonoApp } from './router'
import { watchMockDir } from './watcher'
import type { LoadedRoute, MockerConfig } from '../tools/types'

export async function startServer(config: MockerConfig): Promise<{ stop(): void }> {
  const routesByFile = new Map<string, LoadedRoute[]>()

  const files = await scanMockDir(config.dir)
  await Promise.all(files.map(async (f) => {
    routesByFile.set(f, await loadMockFile(f))
  }))

  const allRoutes = () => Array.from(routesByFile.values()).flat()

  let app = buildHonoApp(allRoutes(), config)

  const bunServer = Bun.serve({
    port: config.port,
    fetch: (req) => app.fetch(req),
  })

  console.log(`[mocker] Listening on http://localhost:${config.port}`)
  console.log(`[mocker] Mock directory: ${config.dir}`)
  if (config.fallback) console.log(`[mocker] Fallback: ${config.fallback}`)
  if (!config.enable) console.log('[mocker] Mock disabled — all requests forwarded')

  const watcher = watchMockDir(config.dir, async (changed) => {
    const routes = await loadMockFile(changed)
    if (!existsSync(changed)) {
      // file was deleted — remove its routes
      routesByFile.delete(changed)
    } else if (routes.length > 0) {
      // successfully loaded new routes
      routesByFile.set(changed, routes)
    }
    // else: parse error — keep previous routes (already in map)
    app = buildHonoApp(allRoutes(), config)
    bunServer.reload({ fetch: (req) => app.fetch(req) })
    console.log('[mocker] Routes reloaded')
  })

  return { stop() { watcher.close(); bunServer.stop() } }
}
