import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { registerUser } from '../../src/services/authService.js'
import { generateAccessToken } from '../../src/utils/generateToken.js'

const { authMiddleware } = await import('../../src/middleware/authMiddleware.js')
const { adminMiddleware } = await import('../../src/middleware/adminMiddleware.js')
const { managerMiddleware } = await import('../../src/middleware/managerMiddleware.js')

const USER_DATA = {
  email: 'mw-user@test.com',
  password: 'TestPass123!',
  role: 'USER' as const,
  companyName: 'ООО Мидлвар',
  unp: '111222333',
  phone: '+375291234500',
}

const MANAGER_DATA = {
  email: 'mw-manager@test.com',
  password: 'TestPass123!',
  role: 'MANAGER' as const,
  name: 'Менеджер Иванов',
}

let userId: number
let managerId: number
let userToken: string
let managerToken: string

// ---------- helpers ----------

function makeApp(...middlewares: any[]) {
  const app = express()
  app.use(cookieParser())

  // Чтобы не падало на отсутствии logMeta
  app.use((req: any, _res: any, next: any) => {
    req.logMeta = {}
    next()
  })

  for (const mw of middlewares) {
    app.use(mw)
  }

  app.get('/test', (_req: any, res: any) => {
    res.json({ success: true, user: _req.user })
  })

  return app
}

beforeEach(async () => {
  const { prisma } = await import('../../src/config/db.js')

  const user = await registerUser(USER_DATA)
  userId = user.id
  userToken = generateAccessToken(userId, 'session-mw')
  await prisma.user.update({
    where: { id: userId },
    data: { currentSessionId: 'session-mw' },
  })

  const mgr = await registerUser(MANAGER_DATA)
  managerId = mgr.id
  managerToken = generateAccessToken(managerId, 'session-mgr')
  await prisma.user.update({
    where: { id: managerId },
    data: { currentSessionId: 'session-mgr' },
  })
})

// ================================================================
// authMiddleware
// ================================================================

describe('authMiddleware', () => {
  it('пропускает запрос с валидным Bearer токеном', async () => {
    const app = makeApp(authMiddleware)

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.user.id).toBe(userId)
    expect(res.body.user.email).toBe(USER_DATA.email)
  })

  it('пропускает запрос с валидным JWT в cookie', async () => {
    const app = makeApp(authMiddleware)

    const res = await request(app)
      .get('/test')
      .set('Cookie', [`jwt=${userToken}`])
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.user.id).toBe(userId)
  })

  it('отклоняет запрос без токена', async () => {
    const app = makeApp(authMiddleware)

    const res = await request(app).get('/test').expect(401)

    expect(res.body.success).toBe(false)
    expect(res.body.error).toContain('no token')
  })

  it('отклоняет неверный токен', async () => {
    const app = makeApp(authMiddleware)

    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer invalid-jwt')
      .expect(401)

    expect(res.body.success).toBe(false)
    expect(res.body.error).toContain('token failed')
  })

  it('отклоняет заблокированного пользователя', async () => {
    const { prisma } = await import('../../src/config/db.js')
    await prisma.user.update({
      where: { id: userId },
      data: { isBlocked: true },
    })

    const app = makeApp(authMiddleware)

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403)

    expect(res.body.error).toContain('заблокирован')
  })

  it('отклоняет при несовпадении sessionId (superseded)', async () => {
    const { prisma } = await import('../../src/config/db.js')
    await prisma.user.update({
      where: { id: userId },
      data: { currentSessionId: 'different-session' },
    })

    const app = makeApp(authMiddleware)

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(401)

    expect(res.body.error).toContain('Сессия завершена')
    expect(res.body.code).toBe('SESSION_SUPERSEDED')
  })

  it('отклоняет USER при неактивности > 30 минут', async () => {
    const { prisma } = await import('../../src/config/db.js')
    await prisma.user.update({
      where: { id: userId },
      data: { lastSeen: new Date(Date.now() - 31 * 60 * 1000) },
    })

    const app = makeApp(authMiddleware)

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(401)

    expect(res.body.error).toContain('неактивности')
    expect(res.body.code).toBe('SESSION_EXPIRED')
  })

  it('пропускает MANAGER при неактивности < 120 минут', async () => {
    const { prisma } = await import('../../src/config/db.js')
    await prisma.user.update({
      where: { id: managerId },
      data: { lastSeen: new Date(Date.now() - 61 * 60 * 1000) }, // 61 мин — USER бы отклонил
    })

    const app = makeApp(authMiddleware)

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200)

    expect(res.body.success).toBe(true)
  })

  it('отклоняет MANAGER при неактивности > 120 минут', async () => {
    const { prisma } = await import('../../src/config/db.js')
    await prisma.user.update({
      where: { id: managerId },
      data: { lastSeen: new Date(Date.now() - 121 * 60 * 1000) }, // > 120 мин
    })

    const app = makeApp(authMiddleware)

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(401)

    expect(res.body.error).toContain('неактивности')
  })
})

// ================================================================
// adminMiddleware
// ================================================================

describe('adminMiddleware', () => {
  it('пропускает ADMIN', () => {
    const mockReq: any = {
      user: { role: 'ADMIN', id: 1, email: 'admin@test.com' },
      logMeta: {},
    }
    let called = false
    const mockRes: any = {
      status: () => ({ json: () => {} }),
    }
    const mockNext = () => {
      called = true
    }

    adminMiddleware(mockReq, mockRes, mockNext)
    expect(called).toBe(true)
  })

  it('блокирует MANAGER', () => {
    const mockReq: any = {
      user: { role: 'MANAGER', id: 1, email: 'mgr@test.com' },
      logMeta: {},
    }
    let statusCode = 0
    const mockRes: any = {
      status: (code: number) => {
        statusCode = code
        return { json: (_body: any) => {} }
      },
    }
    const mockNext = () => {
      throw new Error('next should not be called')
    }

    adminMiddleware(mockReq, mockRes, mockNext)
    expect(statusCode).toBe(403)
  })

  it('блокирует USER', () => {
    const mockReq: any = {
      user: { role: 'USER', id: 1, email: 'user@test.com' },
      logMeta: {},
    }
    let statusCode = 0
    const mockRes: any = {
      status: (code: number) => {
        statusCode = code
        return { json: (_body: any) => {} }
      },
    }
    const mockNext = () => {
      throw new Error('next should not be called')
    }

    adminMiddleware(mockReq, mockRes, mockNext)
    expect(statusCode).toBe(403)
  })
})

// ================================================================
// managerMiddleware
// ================================================================

describe('managerMiddleware', () => {
  it('пропускает MANAGER', () => {
    const mockReq: any = {
      user: { role: 'MANAGER', id: 1 },
      logMeta: {},
    }
    let called = false
    const mockRes: any = {
      status: () => ({ json: () => {} }),
    }
    const mockNext = () => {
      called = true
    }

    managerMiddleware(mockReq, mockRes, mockNext)
    expect(called).toBe(true)
  })

  it('блокирует USER', () => {
    const mockReq: any = {
      user: { role: 'USER', id: 1 },
      logMeta: {},
    }
    let statusCode = 0
    const mockRes: any = {
      status: (code: number) => {
        statusCode = code
        return { json: () => {} }
      },
    }
    const mockNext = () => {
      throw new Error('next should not be called')
    }

    managerMiddleware(mockReq, mockRes, mockNext)
    expect(statusCode).toBe(403)
  })

  it('блокирует без req.user', () => {
    const mockReq: any = {
      logMeta: {},
    }
    let statusCode = 0
    const mockRes: any = {
      status: (code: number) => {
        statusCode = code
        return { json: () => {} }
      },
    }
    const mockNext = () => {
      throw new Error('next should not be called')
    }

    managerMiddleware(mockReq, mockRes, mockNext)
    expect(statusCode).toBe(403)
  })
})
