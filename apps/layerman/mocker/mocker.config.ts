import type { MockerConfig } from './tools/types'

export default {
  port: 3000,
  dir: './src',
  fallback: '',
  enable: true,
  authToken: '',
  authValidator: undefined,
} satisfies Partial<MockerConfig>
