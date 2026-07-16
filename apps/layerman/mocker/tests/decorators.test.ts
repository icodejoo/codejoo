import { describe, it, expect } from 'bun:test'
import { auth, getAuthEnabled, get, post, del, getRouteMeta } from '../tools/decorators'

describe('auth decorator', () => {
  it('getAuthEnabled returns true for @auth(true)', () => {
    class Mock {
      @auth(true)
      ['GET /api/users']() {}
    }
    expect(getAuthEnabled(Mock.prototype['GET /api/users'])).toBe(true)
  })

  it('getAuthEnabled returns false for @auth(false)', () => {
    class Mock {
      @auth(false)
      ['GET /api/public']() {}
    }
    expect(getAuthEnabled(Mock.prototype['GET /api/public'])).toBe(false)
  })

  it('getAuthEnabled returns true for @auth (no parentheses)', () => {
    class Mock {
      @auth
      bare() {}
    }
    expect(getAuthEnabled(Mock.prototype.bare)).toBe(true)
  })

  it('getAuthEnabled returns true for @auth() (empty call)', () => {
    class Mock {
      @auth()
      empty() {}
    }
    expect(getAuthEnabled(Mock.prototype.empty)).toBe(true)
  })

  it('getAuthEnabled returns undefined for undecorated method', () => {
    class Mock {
      ['GET /api/plain']() {}
    }
    expect(getAuthEnabled(Mock.prototype['GET /api/plain'])).toBeUndefined()
  })

  it('decorator does not alter method behavior', () => {
    class Mock {
      @auth
      greet() { return 'hello' }
    }
    expect(new Mock().greet()).toBe('hello')
  })
})

describe('route decorators (@get / @post / @del)', () => {
  it('@get(path) records GET method and path', () => {
    class Mock {
      @get('/users')
      list() {}
    }
    expect(getRouteMeta(Mock.prototype.list)).toEqual({ method: 'GET', path: '/users' })
  })

  it('@post(path) records POST method and path', () => {
    class Mock {
      @post('/users')
      create() {}
    }
    expect(getRouteMeta(Mock.prototype.create)).toEqual({ method: 'POST', path: '/users' })
  })

  it('@del(path) records DELETE method and path', () => {
    class Mock {
      @del('/users/:id')
      remove() {}
    }
    expect(getRouteMeta(Mock.prototype.remove)).toEqual({ method: 'DELETE', path: '/users/:id' })
  })

  it('@auth and @get(path) can be combined on the same method', () => {
    class Mock {
      @auth(false)
      @get('/items')
      list() {}
    }
    expect(getRouteMeta(Mock.prototype.list)).toEqual({ method: 'GET', path: '/items' })
    expect(getAuthEnabled(Mock.prototype.list)).toBe(false)
  })

  it('decorator does not alter method behavior', () => {
    class Mock {
      @get('/test')
      greet() { return 'hello' }
    }
    expect(new Mock().greet()).toBe('hello')
  })
})
