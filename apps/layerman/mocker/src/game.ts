import { get, post, put, del } from '../tools/decorators'
import type { MockRequest, MockResponse } from '../tools/types'
import gameData from '../data/game.json'

type Game = (typeof gameData)[number]

// In-memory store — resets on hot reload
let store: Game[] = [...gameData]

const NUM_FLAGS = ['gameType', 'flag', 'hotFlag', 'newFlag', 'recommendFlag', 'maintenanceFlag', 'poolFlag', 'tryFlag', 'payoutFlag', 'preferenceFlag', 'localFlag', 'isUpHot', 'playerType'] as const

function filterGames(filters: Record<string, string>): Game[] {
  let result = store

  if (filters.gameName) {
    const kw = filters.gameName.toLowerCase()
    result = result.filter(g => g.gameName.toLowerCase().includes(kw))
  }
  if (filters.gameKind)          result = result.filter(g => g.gameKind === filters.gameKind)
  if (filters.gameSupplier)      result = result.filter(g => g.gameSupplier === filters.gameSupplier)
  if (filters.platformId)        result = result.filter(g => g.platformId === filters.platformId)
  if (filters.screenOrientation) result = result.filter(g => g.screenOrientation === filters.screenOrientation)
  if (filters.appGroup)          result = result.filter(g => g.appGroup === filters.appGroup)

  for (const key of NUM_FLAGS) {
    if (filters[key] !== undefined && filters[key] !== '') {
      const val = Number(filters[key])
      result = result.filter(g => (g as Record<string, unknown>)[key] === val)
    }
  }

  return result
}

function sortGames(games: Game[], sortBy?: string, sortOrder?: string): Game[] {
  if (!sortBy) return games
  const dir = sortOrder === 'desc' ? -1 : 1
  return [...games].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortBy]
    const bv = (b as Record<string, unknown>)[sortBy]
    if (av === bv) return 0
    return av < bv ? -dir : dir
  })
}

function paginate(games: Game[], page: number, pageSize: number) {
  return {
    total: games.length,
    page,
    pageSize,
    list: games.slice((page - 1) * pageSize, page * pageSize),
  }
}

function parsePage(q: Record<string, string>) {
  return {
    page: Math.max(1, Number(q.page) || 1),
    pageSize: Math.min(200, Math.max(1, Number(q.pageSize) || 20)),
  }
}

export default class GameMock {
  static readonly baseUrl = '/api'

  @get('/games')
  list(req: MockRequest, res: MockResponse) {
    const { page, pageSize } = parsePage(req.query)
    const filtered = filterGames(req.query)
    const sorted = sortGames(filtered, req.query.sortBy, req.query.sortOrder)
    return res.resolve(paginate(sorted, page, pageSize))
  }

  @get('/games/:id')
  getById(req: MockRequest, res: MockResponse) {
    const game = store.find(g => g.id === Number(req.params.id))
    return game ? res.resolve(game) : res.reject('Game not found', 404)
  }

  @post('/games')
  create(req: MockRequest, res: MockResponse) {
    const game = { ...(req.body as Partial<Game>), id: Date.now() } as Game
    store.push(game)
    return res.resolve(game, 201)
  }

  @post('/games/query')
  query(req: MockRequest, res: MockResponse) {
    const body = (req.body ?? {}) as {
      filters?: Record<string, string | number>
      page?: number
      pageSize?: number
      sortBy?: string
      sortOrder?: string
    }
    const page = Math.max(1, body.page ?? 1)
    const pageSize = Math.min(200, Math.max(1, body.pageSize ?? 20))
    const rawFilters = body.filters ?? {}
    const filters: Record<string, string> = {}
    for (const [k, v] of Object.entries(rawFilters)) {
      if (v !== undefined && v !== null && v !== '') filters[k] = String(v)
    }
    const filtered = filterGames(filters)
    const sorted = sortGames(filtered, body.sortBy, body.sortOrder)
    return res.resolve(paginate(sorted, page, pageSize))
  }

  @put('/games/:id')
  update(req: MockRequest, res: MockResponse) {
    const idx = store.findIndex(g => g.id === Number(req.params.id))
    if (idx === -1) return res.reject('Game not found', 404)
    store[idx] = { ...store[idx], ...(req.body as Partial<Game>), id: store[idx].id }
    return res.resolve(store[idx])
  }

  @del('/games/:id')
  removeById(req: MockRequest, res: MockResponse) {
    const idx = store.findIndex(g => g.id === Number(req.params.id))
    if (idx === -1) return res.reject('Game not found', 404)
    store.splice(idx, 1)
    return res.resolve(null, 204)
  }

  @del('/games')
  batchRemove(req: MockRequest, res: MockResponse) {
    const body = req.body as { ids?: number[] }
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      return res.reject('ids must be a non-empty array', 400)
    }
    const idSet = new Set(body.ids)
    const before = store.length
    store = store.filter(g => !idSet.has(g.id))
    return res.resolve({ deleted: before - store.length })
  }
}
