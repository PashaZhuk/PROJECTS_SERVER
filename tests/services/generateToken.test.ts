import { describe, it, expect, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { registerUser } from '../../src/services/authService.js'
import { prisma } from '../../src/config/db.js'

// Импортируем тестируемые функции
const {
  generateAccessToken,
  setAccessTokenCookie,
  generateAndStoreRefreshToken,
  generateTokens,
  rotateRefreshToken,
  revokeUserRefreshTokens,
} = await import('../../src/utils/generateToken.js')

// ---------- helpers ----------

function mockRes() {
  const cookies: Record<string, unknown> = {}
  const cleared: string[] = []
  return {
    cookie: (name: string, value: unknown, _opts?: any) => {
      cookies[name] = value
    },
    clearCookie: (name: string) => {
      cleared.push(name)
    },
    getCookie: (name: string) => cookies[name],
    wasCleared: (name: string) => cleared.includes(name),
  } as any
}

const USER_DATA = {
  email: 'token-test@test.com',
  password: 'StrongPass123!',
  role: 'USER' as const,
  companyName: 'ООО Токен Тест',
  unp: '999888777',
  phone: '+375291112233',
}

let userId: number

beforeEach(async () => {
  const user = await registerUser(USER_DATA)
  userId = user.id
})

// ================================================================
// generateAccessToken
// ================================================================

describe('generateAccessToken', () => {
  it('создаёт валидный JWT с id и sessionId', () => {
    const token = generateAccessToken(userId, 'session-123')

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
    expect(decoded.id).toBe(userId)
    expect(decoded.sessionId).toBe('session-123')
    expect(decoded.iat).toBeDefined()
    expect(decoded.exp).toBeDefined()
  })

  it('создаёт JWT со сроком 15 минут', () => {
    const token = generateAccessToken(userId, 'session-1')
    const decoded = jwt.decode(token) as any
    const exp = decoded.exp!
    const iat = decoded.iat!
    const diffMinutes = (exp - iat) / 60
    expect(diffMinutes).toBeCloseTo(15, 0)
  })

  it('принимает userId как строку', () => {
    const token = generateAccessToken(String(userId), 'session-456')
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
    expect(Number(decoded.id)).toBe(userId)
  })
})

// ================================================================
// setAccessTokenCookie
// ================================================================

describe('setAccessTokenCookie', () => {
  it('устанавливает cookie jwt', () => {
    const res = mockRes()
    setAccessTokenCookie('test-token', res)

    expect(res.getCookie('jwt')).toBe('test-token')
  })
})

// ================================================================
// generateAndStoreRefreshToken
// ================================================================

describe('generateAndStoreRefreshToken', () => {
  it('создаёт запись в БД и устанавливает cookie', async () => {
    const res = mockRes()
    const rawToken = await generateAndStoreRefreshToken(userId, 'session-r1', res)

    expect(rawToken).toBeDefined()
    expect(typeof rawToken).toBe('string')
    expect(rawToken.length).toBeGreaterThan(0)

    // Проверяем cookie
    expect(res.getCookie('refreshToken')).toBe(rawToken)

    // Проверяем запись в БД
    const stored = await prisma.refreshToken.findFirst({
      where: { userId },
    })
    expect(stored).not.toBeNull()
    expect(stored!.sessionId).toBe('session-r1')
    expect(stored!.revokedAt).toBeNull()
    expect(stored!.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })
})

// ================================================================
// generateTokens
// ================================================================

describe('generateTokens', () => {
  it('создаёт access + refresh токены и устанавливает обе cookie', async () => {
    const res = mockRes()
    const { accessToken } = await generateTokens(userId, 'session-g1', res)

    // Access token
    expect(accessToken).toBeDefined()
    expect(res.getCookie('jwt')).toBe(accessToken)

    // Refresh token
    const refreshCookie = res.getCookie('refreshToken')
    expect(refreshCookie).toBeDefined()

    // В БД есть запись
    const stored = await prisma.refreshToken.count({ where: { userId } })
    expect(stored).toBe(1)
  })
})

// ================================================================
// rotateRefreshToken
// ================================================================

describe('rotateRefreshToken', () => {
  it('успешно ротирует токен', async () => {
    // Сначала создаём пару токенов
    const res1 = mockRes()
    await generateTokens(userId, 'session-rot', res1)
    const oldRaw = res1.getCookie('refreshToken') as string

    // Ротируем
    const res2 = mockRes()
    const result = await rotateRefreshToken(oldRaw, res2)

    expect(result.success).toBe(true)
    expect(result.accessToken).toBeDefined()
    expect(result.user).toBeDefined()
    expect(result.user.email).toBe(USER_DATA.email)

    // Старый токен отозван
    const oldHash = cryptoHash(oldRaw)
    const oldRecord = await prisma.refreshToken.findUnique({
      where: { tokenHash: oldHash },
    })
    expect(oldRecord!.revokedAt).not.toBeNull()

    // Новый токен в cookie
    expect(res2.getCookie('refreshToken')).toBeDefined()
    expect(res2.getCookie('refreshToken')).not.toBe(oldRaw)

    // В БД теперь 2 записи (старый отозван + новый)
    const count = await prisma.refreshToken.count({ where: { userId } })
    expect(count).toBe(2)
  })

  it('возвращает ошибку если токен не передан', async () => {
    const res = mockRes()
    const result = await rotateRefreshToken(undefined, res)

    expect(result.success).toBe(false)
    expect(result.error).toContain('not provided')
  })

  it('возвращает ошибку для несуществующего токена', async () => {
    const res = mockRes()
    const result = await rotateRefreshToken('non-existent-token', res)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid')
    expect(res.wasCleared('refreshToken')).toBe(true)
  })

  it('детектит reuse уже отозванного токена и отзывает все', async () => {
    // Создаём токен и сразу отзываем его
    const res1 = mockRes()
    await generateTokens(userId, 'session-reuse', res1)
    const raw = res1.getCookie('refreshToken') as string

    // Ротируем один раз — нормально
    const res2 = mockRes()
    await rotateRefreshToken(raw, res2)

    // Пытаемся использовать СТАРЫЙ токен снова — reuse detection
    const res3 = mockRes()
    const result = await rotateRefreshToken(raw, res3)

    expect(result.success).toBe(false)
    expect(result.error).toContain('reuse')

    // Все токены пользователя отозваны
    const activeTokens = await prisma.refreshToken.count({
      where: { userId, revokedAt: null },
    })
    expect(activeTokens).toBe(0)
  })

  it('отклоняет истёкший токен', async () => {
    const res1 = mockRes()
    await generateTokens(userId, 'session-exp', res1)
    const raw = res1.getCookie('refreshToken') as string

    // Протухаем токен вручную
    const hash = cryptoHash(raw)
    await prisma.refreshToken.update({
      where: { tokenHash: hash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const res2 = mockRes()
    const result = await rotateRefreshToken(raw, res2)

    expect(result.success).toBe(false)
    expect(result.error).toContain('expired')
    expect(res2.wasCleared('refreshToken')).toBe(true)
  })
})

// ================================================================
// revokeUserRefreshTokens
// ================================================================

describe('revokeUserRefreshTokens', () => {
  it('отзывает все токены пользователя', async () => {
    const res = mockRes()
    await generateTokens(userId, 'session-rev1', res)
    await generateTokens(userId, 'session-rev2', res)

    await revokeUserRefreshTokens(userId)

    const active = await prisma.refreshToken.count({
      where: { userId, revokedAt: null },
    })
    expect(active).toBe(0)

    const all = await prisma.refreshToken.count({ where: { userId } })
    expect(all).toBe(2)
  })

  it('отзывает только токены указанной сессии', async () => {
    const res = mockRes()
    await generateTokens(userId, 'session-s1', res)
    await generateTokens(userId, 'session-s2', res)

    await revokeUserRefreshTokens(userId, 'session-s1')

    const active = await prisma.refreshToken.count({
      where: { userId, revokedAt: null },
    })
    expect(active).toBe(1)

    const s2Token = await prisma.refreshToken.findFirst({
      where: { userId, sessionId: 'session-s2' },
    })
    expect(s2Token!.revokedAt).toBeNull()
  })
})

// ---------- internal ----------

function cryptoHash(token: string): string {
  const crypto = require('crypto')
  return crypto.createHash('sha256').update(token).digest('hex')
}
