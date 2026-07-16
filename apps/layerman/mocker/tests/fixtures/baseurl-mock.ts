import { auth, get, post } from '../../tools/decorators'
import type { MockRequest, MockResponse } from '../../tools/types'

export default class BaseUrlMock {
  static readonly baseUrl = '/api'

  @auth(false)
  @get('/things')
  list(_req: MockRequest, res: MockResponse) {
    return res.resolve([{ id: 1 }])
  }

  @auth
  @post('/things')
  create(_req: MockRequest, res: MockResponse) {
    return res.resolve({ id: 2 }, 201)
  }
}
