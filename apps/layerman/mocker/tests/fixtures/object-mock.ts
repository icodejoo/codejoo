import type { MockRequest, MockResponse } from '../../tools/types'

export default {
  'GET /api/items': (_req: MockRequest, res: MockResponse) => res.resolve([{ id: 1 }]),
  'POST /api/items': (_req: MockRequest, res: MockResponse) => res.resolve({ id: 2 }, 201),
}
