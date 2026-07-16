import { auth } from '../../tools/decorators'
import type { MockRequest, MockResponse } from '../../tools/types'

export default class ClassMock {
  @auth(true)
  ['GET /api/secure'](_req: MockRequest, res: MockResponse) {
    return res.resolve({ secret: true })
  }

  @auth(false)
  ['DELETE /api/public'](_req: MockRequest, res: MockResponse) {
    return res.resolve(null, 204)
  }
}
