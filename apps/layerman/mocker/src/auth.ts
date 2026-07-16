import { auth, get, post, put } from '../tools/decorators'
import type { MockRequest, MockResponse } from '../tools/types'

// ── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: number
  username: string
  email: string
  phone: string
  password: string
  avatar: string
  nickname: string
  status: 'active' | 'inactive' | 'banned'
  emailVerified: boolean
  phoneVerified: boolean
  roles: string[]
  createdAt: string
  updatedAt: string
}

interface Session {
  token: string
  refreshToken: string
  userId: number
  expiresAt: number
}

interface VerifyCode {
  code: string
  target: string
  expiresAt: number
}

// ── In-memory stores (reset on hot reload) ────────────────────────────────────

let nextId = 100

const users: User[] = [
  {
    id: 1,
    username: 'admin',
    email: 'admin@example.com',
    phone: '13800138000',
    password: 'Admin123!',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
    nickname: 'Admin',
    status: 'active',
    emailVerified: true,
    phoneVerified: true,
    roles: ['admin', 'user'],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 2,
    username: 'user',
    email: 'user@example.com',
    phone: '13900139000',
    password: 'User123!',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user',
    nickname: 'User',
    status: 'active',
    emailVerified: true,
    phoneVerified: false,
    roles: ['user'],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
]

const sessions      = new Map<string, Session>()
const refreshTokens = new Map<string, string>()    // refreshToken → accessToken
const verifyCodes   = new Map<string, VerifyCode>() // `${type}:${target}` → code

// ── Helpers ───────────────────────────────────────────────────────────────────

const TOKEN_TTL   = 2 * 60 * 60 * 1000        // 2 h
const REFRESH_TTL = 30 * 24 * 60 * 60 * 1000  // 30 d
const CODE_TTL = {
  register: 5 * 60 * 1000,
  login:    5 * 60 * 1000,
  reset:   15 * 60 * 1000,
  bind:     5 * 60 * 1000,
}

function uid() {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function sixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function createSession(userId: number) {
  const token        = `mock_tk_${uid()}`
  const refreshToken = `mock_rt_${uid()}`
  const now = Date.now()
  sessions.set(token, { token, refreshToken, userId, expiresAt: now + TOKEN_TTL })
  refreshTokens.set(refreshToken, token)
  return { accessToken: token, refreshToken, expiresIn: TOKEN_TTL / 1000 }
}

function revokeAllSessions(userId: number) {
  for (const [token, s] of sessions) {
    if (s.userId === userId) { refreshTokens.delete(s.refreshToken); sessions.delete(token) }
  }
}

function currentToken(req: MockRequest) {
  const h = req.headers['authorization'] ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : h
}

function sessionUser(req: MockRequest): User | null {
  const session = sessions.get(currentToken(req))
  if (!session || session.expiresAt < Date.now()) return null
  return users.find(u => u.id === session.userId) ?? null
}

function safe(user: User) {
  const { password, ...rest } = user
  return rest
}

const OAUTH_PROVIDERS = new Set(['google', 'github', 'wechat', 'apple', 'facebook', 'twitter', 'line', 'kakao'])

// ── Mock ──────────────────────────────────────────────────────────────────────

export default class AuthMock {
  static readonly baseUrl = '/api/auth'

  // body: { username?, email?, phone?, password, nickname? }
  @auth(false)
  @post('/register')
  register(req: MockRequest, res: MockResponse) {
    const b = req.body as Record<string, string>
    const { username, email, phone, password, nickname } = b

    if (!password) return res.reject('password is required', 400)
    if (!username && !email && !phone) return res.reject('username, email or phone is required', 400)
    if (username && users.some(u => u.username === username)) return res.reject('Username already taken', 409)
    if (email    && users.some(u => u.email    === email))    return res.reject('Email already registered', 409)
    if (phone    && users.some(u => u.phone    === phone))    return res.reject('Phone already registered', 409)

    const user: User = {
      id: nextId++,
      username: username || email || phone,
      email: email || '',
      phone: phone || '',
      password,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${uid()}`,
      nickname: nickname || username || email || phone,
      status: 'active',
      emailVerified: false,
      phoneVerified: false,
      roles: ['user'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    users.push(user)
    return res.resolve({ user: safe(user), ...createSession(user.id) }, 201)
  }

  // Password login: { account, password }  (account = username | email | phone)
  // Code login:     { phone, code }  or  { email, code }
  @auth(false)
  @post('/login')
  login(req: MockRequest, res: MockResponse) {
    const b = req.body as Record<string, string>
    let user: User | undefined

    if ((b.phone || b.email) && b.code) {
      const target = b.phone || b.email
      const vc = verifyCodes.get(`login:${target}`)
      if (!vc || vc.code !== b.code || vc.expiresAt < Date.now()) return res.reject('Invalid or expired code', 401)
      user = users.find(u => u.phone === target || u.email === target)
      verifyCodes.delete(`login:${target}`)
    } else {
      if (!b.account || !b.password) return res.reject('account and password are required', 400)
      user = users.find(u =>
        (u.username === b.account || u.email === b.account || u.phone === b.account) &&
        u.password === b.password
      )
      if (!user) return res.reject('Invalid credentials', 401)
    }

    if (!user) return res.reject('User not found', 404)
    if (user.status === 'banned')   return res.reject('Account is banned', 403)
    if (user.status === 'inactive') return res.reject('Account is inactive', 403)

    return res.resolve({ user: safe(user), ...createSession(user.id) })
  }

  @auth
  @post('/logout')
  logout(req: MockRequest, res: MockResponse) {
    const token = currentToken(req)
    const session = sessions.get(token)
    if (session) { refreshTokens.delete(session.refreshToken); sessions.delete(token) }
    return res.resolve({ message: 'Logged out' })
  }

  // body: { refreshToken }
  @auth(false)
  @post('/refresh-token')
  refreshToken(req: MockRequest, res: MockResponse) {
    const { refreshToken } = req.body as { refreshToken: string }
    if (!refreshToken) return res.reject('refreshToken is required', 400)

    const oldToken = refreshTokens.get(refreshToken)
    if (!oldToken) return res.reject('Invalid refresh token', 401)

    const session = sessions.get(oldToken)
    if (!session) return res.reject('Session expired', 401)

    refreshTokens.delete(refreshToken)
    sessions.delete(oldToken)
    return res.resolve(createSession(session.userId))
  }

  // body: { target, type }   type: register | login | reset | bind
  // Returns the code in the response body — mock only, for testability
  @auth(false)
  @post('/send-code')
  sendCode(req: MockRequest, res: MockResponse) {
    const { target, type = 'register' } = req.body as { target: string; type?: string }
    if (!target) return res.reject('target (email or phone) is required', 400)
    if (!Object.hasOwn(CODE_TTL, type)) return res.reject(`type must be one of: ${Object.keys(CODE_TTL).join(', ')}`, 400)

    const code = sixDigitCode()
    verifyCodes.set(`${type}:${target}`, { code, target, expiresAt: Date.now() + CODE_TTL[type as keyof typeof CODE_TTL] })
    return res.resolve({ message: 'Code sent', code, expiresIn: CODE_TTL[type as keyof typeof CODE_TTL] / 1000 })
  }

  // body: { target, code, type }
  @auth(false)
  @post('/verify-code')
  verifyCode(req: MockRequest, res: MockResponse) {
    const { target, code, type = 'register' } = req.body as Record<string, string>
    if (!target || !code) return res.reject('target and code are required', 400)

    const vc = verifyCodes.get(`${type}:${target}`)
    if (!vc || vc.code !== code) return res.reject('Invalid code', 400)
    if (vc.expiresAt < Date.now())  return res.reject('Code expired', 400)

    verifyCodes.delete(`${type}:${target}`)

    const user = users.find(u => u.email === target || u.phone === target)
    if (user) {
      if (target.includes('@')) user.emailVerified = true
      else                      user.phoneVerified = true
    }
    return res.resolve({ verified: true })
  }

  // body: { account }   account = email | phone
  @auth(false)
  @post('/forgot-password')
  forgotPassword(req: MockRequest, res: MockResponse) {
    const { account } = req.body as { account: string }
    if (!account) return res.reject('account is required', 400)

    const user = users.find(u => u.email === account || u.phone === account)
    // Avoid account enumeration — always 200 with the same shape
    if (!user) return res.resolve({ message: 'If the account exists, a reset code has been sent' })

    const target = user.email || user.phone
    const code = sixDigitCode()
    verifyCodes.set(`reset:${target}`, { code, target, expiresAt: Date.now() + CODE_TTL.reset })
    return res.resolve({ message: 'Reset code sent', code, expiresIn: CODE_TTL.reset / 1000 })
  }

  // body: { account, code, newPassword }
  @auth(false)
  @post('/reset-password')
  resetPassword(req: MockRequest, res: MockResponse) {
    const { account, code, newPassword } = req.body as Record<string, string>
    if (!account || !code || !newPassword) return res.reject('account, code and newPassword are required', 400)

    const user = users.find(u => u.email === account || u.phone === account)
    if (!user) return res.reject('Account not found', 404)

    const target = user.email || user.phone
    const vc = verifyCodes.get(`reset:${target}`)
    if (!vc || vc.code !== code) return res.reject('Invalid code', 400)
    if (vc.expiresAt < Date.now())  return res.reject('Code expired', 400)

    user.password = newPassword
    user.updatedAt = new Date().toISOString()
    verifyCodes.delete(`reset:${target}`)
    revokeAllSessions(user.id)

    return res.resolve({ message: 'Password reset successfully' })
  }

  // provider: google | github | wechat | apple | facebook | twitter | line | kakao
  // body: { accessToken } or { code }
  @auth(false)
  @post('/oauth/:provider')
  oauthLogin(req: MockRequest, res: MockResponse) {
    const { provider } = req.params
    if (!OAUTH_PROVIDERS.has(provider)) return res.reject(`Unsupported provider: ${provider}`, 400)

    const { accessToken, code } = req.body as Record<string, string>
    if (!accessToken && !code) return res.reject('accessToken or code is required', 400)

    const seed = (accessToken || code).slice(-8)
    const mockEmail = `${provider}+${seed}@oauth.mock`

    let user = users.find(u => u.email === mockEmail)
    if (!user) {
      user = {
        id: nextId++,
        username: mockEmail,
        email: mockEmail,
        phone: '',
        password: '',
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`,
        nickname: `${provider[0].toUpperCase()}${provider.slice(1)} User`,
        status: 'active',
        emailVerified: true,
        phoneVerified: false,
        roles: ['user'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      users.push(user)
    }

    return res.resolve({ user: safe(user), ...createSession(user.id) })
  }

  @auth
  @get('/me')
  me(req: MockRequest, res: MockResponse) {
    const user = sessionUser(req)
    if (!user) return res.reject('Token expired or invalid', 401)
    return res.resolve(safe(user))
  }

  // body: { nickname?, avatar? }
  @auth
  @put('/me')
  updateMe(req: MockRequest, res: MockResponse) {
    const user = sessionUser(req)
    if (!user) return res.reject('Token expired or invalid', 401)

    const { nickname, avatar } = req.body as Record<string, string>
    if (nickname !== undefined) user.nickname = nickname
    if (avatar   !== undefined) user.avatar   = avatar
    user.updatedAt = new Date().toISOString()

    return res.resolve(safe(user))
  }

  // body: { oldPassword, newPassword }
  @auth
  @post('/change-password')
  changePassword(req: MockRequest, res: MockResponse) {
    const user = sessionUser(req)
    if (!user) return res.reject('Token expired or invalid', 401)

    const { oldPassword, newPassword } = req.body as Record<string, string>
    if (!oldPassword || !newPassword) return res.reject('oldPassword and newPassword are required', 400)
    if (user.password !== oldPassword) return res.reject('Old password is incorrect', 400)
    if (oldPassword === newPassword)   return res.reject('New password must differ from old password', 400)

    user.password = newPassword
    user.updatedAt = new Date().toISOString()
    return res.resolve({ message: 'Password changed successfully' })
  }

  // body: { phone, code }
  @auth
  @post('/bind-phone')
  bindPhone(req: MockRequest, res: MockResponse) {
    const user = sessionUser(req)
    if (!user) return res.reject('Token expired or invalid', 401)

    const { phone, code } = req.body as Record<string, string>
    if (!phone || !code) return res.reject('phone and code are required', 400)

    const vc = verifyCodes.get(`bind:${phone}`)
    if (!vc || vc.code !== code) return res.reject('Invalid code', 400)
    if (vc.expiresAt < Date.now())  return res.reject('Code expired', 400)
    if (users.some(u => u.phone === phone && u.id !== user.id)) return res.reject('Phone already in use', 409)

    user.phone = phone
    user.phoneVerified = true
    user.updatedAt = new Date().toISOString()
    verifyCodes.delete(`bind:${phone}`)

    return res.resolve(safe(user))
  }

  // body: { email, code }
  @auth
  @post('/bind-email')
  bindEmail(req: MockRequest, res: MockResponse) {
    const user = sessionUser(req)
    if (!user) return res.reject('Token expired or invalid', 401)

    const { email, code } = req.body as Record<string, string>
    if (!email || !code) return res.reject('email and code are required', 400)

    const vc = verifyCodes.get(`bind:${email}`)
    if (!vc || vc.code !== code) return res.reject('Invalid code', 400)
    if (vc.expiresAt < Date.now())  return res.reject('Code expired', 400)
    if (users.some(u => u.email === email && u.id !== user.id)) return res.reject('Email already in use', 409)

    user.email = email
    user.emailVerified = true
    user.updatedAt = new Date().toISOString()
    verifyCodes.delete(`bind:${email}`)

    return res.resolve(safe(user))
  }
}
