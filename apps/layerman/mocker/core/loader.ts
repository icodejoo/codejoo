import { readdirSync } from 'fs'
import { resolve, extname } from 'path'
import { getAuthEnabled, getRouteMeta } from '../tools/decorators'
import type { LoadedRoute, MockHandler } from '../tools/types'

const ROUTE_RE = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) \//

function parseKey(key: string): { method: string; path: string } | null {
  if (!ROUTE_RE.test(key)) return null
  const idx = key.indexOf(' ')
  return { method: key.slice(0, idx), path: key.slice(idx + 1) }
}

function applyBase(base: string | undefined, path: string): string {
  if (!base) return path
  return base.replace(/\/$/, '') + path
}

function fromObject(obj: Record<string, unknown>): LoadedRoute[] {
  const baseUrl = typeof obj.baseUrl === 'string' ? obj.baseUrl : undefined
  return Object.entries(obj).flatMap(([key, handler]) => {
    if (typeof handler !== 'function') return []
    const parsed = parseKey(key)
    if (!parsed) return []
    return [{ ...parsed, path: applyBase(baseUrl, parsed.path), handler: handler as MockHandler, requiresAuth: false }]
  })
}

function fromClass(Ctor: new () => object): LoadedRoute[] {
  const baseUrl = (Ctor as Record<string, unknown>).baseUrl as string | undefined
  const instance = new Ctor()
  const proto = Object.getPrototypeOf(instance) as Record<string, unknown>
  return Object.getOwnPropertyNames(proto).flatMap((key) => {
    if (key === 'constructor') return []
    const fn = proto[key]
    if (typeof fn !== 'function') return []
    // @get['/path']() decorator takes priority; fall back to ['GET /path'] key format
    const parsed = getRouteMeta(fn as object) ?? parseKey(key)
    if (!parsed) return []
    return [{
      method: parsed.method,
      path: applyBase(baseUrl, parsed.path),
      handler: (fn as MockHandler).bind(instance),
      requiresAuth: getAuthEnabled(fn as object) ?? false,
    }]
  })
}

export async function loadMockFile(filePath: string): Promise<LoadedRoute[]> {
  const abs = resolve(filePath)
  try {
    const mod = await import(`${abs}?t=${Date.now()}`)
    const exported = mod.default
    if (!exported) return []
    if (typeof exported === 'function') return fromClass(exported as new () => object)
    if (typeof exported === 'object') return fromObject(exported as Record<string, unknown>)
    return []
  } catch (err) {
    console.error(`[mocker] Failed to load ${filePath}:`, err)
    return []
  }
}

export async function scanMockDir(dir: string): Promise<string[]> {
  const abs = resolve(dir)
  try {
    return walkDir(abs)
  } catch {
    console.error(`[mocker] Cannot read mock directory: ${abs}`)
    return []
  }
}

function walkDir(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) return walkDir(full)
    if (extname(entry.name) === '.ts' && !entry.name.startsWith('_')) return [full]
    return []
  })
}
