import type { HistoryEntry } from '../tools/types'

const MAX = 200
let seq = 0
const entries: HistoryEntry[] = []

export function record(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): void {
  entries.unshift({ id: ++seq, timestamp: new Date().toISOString(), ...entry })
  if (entries.length > MAX) entries.length = MAX
}

export function query(opts?: { path?: string; method?: string; limit?: number }): HistoryEntry[] {
  let result = entries
  if (opts?.path)   result = result.filter(e => e.path.includes(opts.path!))
  if (opts?.method) result = result.filter(e => e.method === opts.method!.toUpperCase())
  return result.slice(0, opts?.limit ?? MAX)
}

export function clearHistory(): void { entries.length = 0 }
