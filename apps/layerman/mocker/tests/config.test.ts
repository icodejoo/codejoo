import { describe, it, expect } from 'bun:test'
import { defaultConfig, mergeConfig } from '../tools/config'

describe('defaultConfig', () => {
  it('has expected default values', () => {
    expect(defaultConfig.port).toBe(3000)
    expect(defaultConfig.dir).toBe('./src')
    expect(defaultConfig.fallback).toBe('')
    expect(defaultConfig.enable).toBe(true)
    expect(defaultConfig.authToken).toBe('')
    expect(defaultConfig.authValidator).toBeUndefined()
  })
})

describe('mergeConfig', () => {
  it('returns defaults when overrides is empty', () => {
    expect(mergeConfig(defaultConfig, {})).toEqual(defaultConfig)
  })

  it('override values take precedence', () => {
    const result = mergeConfig(defaultConfig, { port: 4000, fallback: 'https://api.prod.com' })
    expect(result.port).toBe(4000)
    expect(result.fallback).toBe('https://api.prod.com')
    expect(result.dir).toBe(defaultConfig.dir)
  })

  it('undefined override values do not overwrite defaults', () => {
    const result = mergeConfig(defaultConfig, { port: undefined })
    expect(result.port).toBe(defaultConfig.port)
  })

  it('enable: false is preserved', () => {
    const result = mergeConfig(defaultConfig, { enable: false })
    expect(result.enable).toBe(false)
  })
})
