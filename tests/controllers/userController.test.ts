import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// --- Mocks ---
vi.mock('../../src/config/db.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

// authMiddleware пропускает (юзер авторизован), adminMiddleware не нужен для /change-password
vi.mock('../../src/middleware/authMiddleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 1, role: 'USER' }
    next()
  },
}))

vi.mock('../../src/services/userService.js', () => ({
  changeUserPassword: vi.fn().mockResolvedValue(undefined),
}))

const { default: userRoutes } = await import('../../src/routes/userRoutes.js')

const app = express()
app.use(express.json())
app.use('/user', userRoutes)

describe('POST /user/change-password (принудительная смена)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('принимает { newPassword } БЕЗ currentPassword — регрессия B12 (400 «Ошибка валидации данных») не воспроизводится', async () => {
    const res = await request(app).post('/user/change-password').send({ newPassword: 'newpass123' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('отклоняет короткий пароль (min 6)', async () => {
    const res = await request(app).post('/user/change-password').send({ newPassword: '123' })
    expect(res.status).toBe(400)
  })
})
