import { auth, get, post, del } from '../tools/decorators'
import type { MockRequest, MockResponse } from '../tools/types'
import users from '../data/users.json'

export default class UserMock {
  static readonly baseUrl = '/api'

  @auth
  @get('/users')
  list(_req: MockRequest, res: MockResponse) {
    return res.resolve(users)
  }

  @auth
  @post('/users')
  create(req: MockRequest, res: MockResponse) {
    return res.resolve({ id: Date.now(), ...(req.body as object) }, 201)
  }

  @auth(false)
  @get('/users/:id')
  getById(req: MockRequest, res: MockResponse) {
    const user = users.find(u => u.id === Number(req.params.id))
    return user ? res.resolve(user) : res.reject('Not found', 404)
  }

  @auth(false)
  @del('/users/:id')
  removeById(_req: MockRequest, res: MockResponse) {
    return res.resolve(null, 204)
  }
}
