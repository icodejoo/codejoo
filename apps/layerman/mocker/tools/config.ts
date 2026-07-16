import type { MockerConfig } from './types'
import { existsSync } from 'fs'
import { resolve } from 'path'

export const defaultConfig: MockerConfig = {
  port: 3000,
  dir: './src',
  fallback: '',
  proxy: {},
  enable: true,
  authToken: '',
  authValidator: undefined,
}

export function mergeConfig(
  base: MockerConfig,
  overrides: Partial<MockerConfig>
): MockerConfig {
  const result = { ...base }
  for (const key of Object.keys(overrides) as (keyof MockerConfig)[]) {
    const value = overrides[key]
    if (value !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(result as any)[key] = value
    }
  }
  return result
}

export async function loadConfigFile(configPath: string): Promise<Partial<MockerConfig>> {
  const absPath = resolve(configPath)
  if (!existsSync(absPath)) return {}
  try {
    const mod = await import(`${absPath}?t=${Date.now()}`)
    return (mod.default ?? {}) as Partial<MockerConfig>
  } catch {
    console.warn(`[mocker] Failed to load config file: ${absPath}`)
    return {}
  }
}
