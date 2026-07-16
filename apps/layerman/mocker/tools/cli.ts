import { parseArgs } from 'util'
import { loadConfigFile, mergeConfig, defaultConfig } from './config'
import { startServer } from '../core/server'
import type { MockerConfig } from './types'

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      config:       { type: 'string' },
      port:         { type: 'string' },
      dir:          { type: 'string' },
      fallback:     { type: 'string' },
      enable:       { type: 'boolean' },
      'auth-token': { type: 'string' },
    },
    strict: false,
  })

  const fileConfig = values['config'] ? await loadConfigFile(values['config'] as string) : {}

  const cliOverrides: Partial<MockerConfig> = {}
  if (values['port'])              cliOverrides.port = Number(values['port'])
  if (values['dir'])               cliOverrides.dir = values['dir'] as string
  if (values['fallback'])          cliOverrides.fallback = values['fallback'] as string
  if (values['enable'] !== undefined) cliOverrides.enable = values['enable'] as boolean
  if (values['auth-token'])        cliOverrides.authToken = values['auth-token'] as string

  const config = mergeConfig(mergeConfig(defaultConfig, fileConfig), cliOverrides)
  await startServer(config)
}

main().catch((err) => {
  console.error('[mocker] Fatal:', err)
  process.exit(1)
})
