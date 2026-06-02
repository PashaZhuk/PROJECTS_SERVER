import { describe, it, expect } from 'vitest'
import { registerUser, loginUser, send2FACodeService, verify2FACodeService } from '../../src/services/authService.js'
import { AppError } from '../../src/utils/AppError.js'

// ---------- helpers ----------

function mockRes() {
  const cookies: Record<string, unknown> = {}
  return {
    cookie: (name: string, value: unknown) => { cookies[name] = value },
    clearCookie: () => {},
    getCookie: (name: string) => cookies[name],
  } as any
}

const USER_DATA = {
  email: 'partner@test.com',
  password: 'StrongPass123!',
  role: 'USER' as const,
  companyName: 'ООО Тест',
  unp: '123456789',
  phone: '+375291234567',
}

const MANAGER_DATA = {
  email: 'manager@test.com',
  password: 'ManagerPass1!',
  role: 'MANAGER' as const,
  name: 'Иван Менеджеров',
}

// ================================================================
// registerUser
// ================================================================

describe('registerUser', () => {
  it('создаёт USER с companyName, unp, phone', async () => {
    const user = await registerUser(USER_DATA)

    expect(user.id).toBeGreaterThan(0)
    expect(user.email).toBe(USER_DATA.email)
    expect(user.role).toBe('USER')
    expect(user.companyName).toBe('ООО Тест')
    expect(user.unp).toBe('123456789')
    expect(user.phone).toBe('+375291234567')
    expect(user.mustChangePassword).toBe(true)
    expect(user.password).not.toBe(USER_DATA.password) // хеширован
  })

  it('создаёт MANAGER без company/unp/phone', async () => {
    const user = await registerUser(MANAGER_DATA)

    expect(user.id).toBeGreaterThan(0)
    expect(user.email).toBe(MANAGER_DATA.email)
    expect(user.role).toBe('MANAGER')
    expect(user.companyName).toBeNull()
    expect(user.unp).toBeNull()
    expect(user.phone).toBeNull()
  })

  it('отклоняет дубликат email', async () => {
    await registerUser(USER_DATA)

    await expect(
      registerUser({ ...USER_DATA, unp: '999999999', phone: '+375291111111' })
    ).rejects.toThrow(AppError)
  })

  it('отклоняет дубликат УНП', async () => {
    await registerUser(USER_DATA)

    await expect(
      registerUser({ ...USER_DATA, email: 'other@test.com', phone: '+375291111111' })
    ).rejects.toThrow(AppError)
  })

  it('отклоняет USER без обязательных полей', async () => {
    await expect(
      registerUser({ ...USER_DATA, companyName: '' })
    ).rejects.toThrow(AppError)
  })
})

// ================================================================
// loginUser
// ================================================================

describe('loginUser', () => {
  it('пропускает MANAGER без 2FA', async () => {
    await registerUser(MANAGER_DATA)
    const res = mockRes()
    const result = await loginUser(MANAGER_DATA.email, MANAGER_DATA.password, res)

    expect(result.success).toBe(true)
    expect(result.user).toBeDefined()
    expect(result.user!.role).toBe('MANAGER')
  })

  it('требует 2FA для USER', async () => {
    await registerUser(USER_DATA)
    const res = mockRes()
    const result = await loginUser(USER_DATA.email, USER_DATA.password, res)

    expect(result.success).toBe(false)
    expect(result.requires2FA).toBe(true)
    expect(result.userId).toBeGreaterThan(0)
  })

  it('отклоняет неверный пароль', async () => {
    await registerUser(USER_DATA)
    const res = mockRes()
    const result = await loginUser(USER_DATA.email, 'wrong-password', res)

    expect(result.success).toBe(false)
    expect(result.attemptsLeft).toBe(4)
  })

  it('блокирует после 5 неудачных попыток', async () => {
    await registerUser(USER_DATA)
    const res = mockRes()

    for (let i = 0; i < 5; i++) {
      await loginUser(USER_DATA.email, 'wrong-password', res)
    }

    const result = await loginUser(USER_DATA.email, 'wrong-password', res)
    expect(result.success).toBe(false)
    expect(result.lockType).toBe('password')
    expect(result.timeLeft).toBeGreaterThan(0)
  })

  it('сбрасывает счётчик после успешного входа', async () => {
    await registerUser(MANAGER_DATA)
    const res = mockRes()

    // 3 неудачных попытки
    for (let i = 0; i < 3; i++) {
      await loginUser(MANAGER_DATA.email, 'wrong', res)
    }

    // успешный вход
    const ok = await loginUser(MANAGER_DATA.email, MANAGER_DATA.password, res)
    expect(ok.success).toBe(true)

    // снова неверный — счётчик сброшен
    const fail = await loginUser(MANAGER_DATA.email, 'wrong', res)
    expect(fail.attemptsLeft).toBe(4) // начинаем с 5 заново
  })
})

// ================================================================
// send2FACodeService
// ================================================================

describe('send2FACodeService', () => {
  it('возвращает debugCode (SMS не настроен)', async () => {
    await registerUser(USER_DATA)
    const res = mockRes()
    const login = await loginUser(USER_DATA.email, USER_DATA.password, res)

    const result = await send2FACodeService(login.userId!)
    expect(result).toHaveProperty('debugCode')
    expect(result.debugCode).toMatch(/^\d{6}$/)
  })

  it('блокирует повторную отправку раньше 60 сек', async () => {
    await registerUser(USER_DATA)
    const res = mockRes()
    const login = await loginUser(USER_DATA.email, USER_DATA.password, res)

    await send2FACodeService(login.userId!)
    await expect(
      send2FACodeService(login.userId!)
    ).rejects.toThrow(AppError)
  })

  it('отклоняет запрос для заблокированного по 2FA пользователя', async () => {
    // Регистрируем, логинимся, отправляем код — но сначала заблокируем
    await registerUser(USER_DATA)

    // Смоделируем блокировку прямо через prisma
    const { prisma } = await import('../../src/config/db.js')
    const user = await prisma.user.findUnique({ where: { email: USER_DATA.email } })
    await prisma.user.update({
      where: { id: user!.id },
      data: { twoFactorLockUntil: new Date(Date.now() + 60_000) },
    })

    await expect(
      send2FACodeService(user!.id)
    ).rejects.toThrow(AppError)
  })
})

// ================================================================
// verify2FACodeService
// ================================================================

describe('verify2FACodeService', () => {
  it('успешно верифицирует корректный код', async () => {
    await registerUser(USER_DATA)
    const res = mockRes()
    const login = await loginUser(USER_DATA.email, USER_DATA.password, res)

    const { debugCode } = await send2FACodeService(login.userId!)
    const verifyRes = mockRes()
    const result = await verify2FACodeService(login.userId!, debugCode!, verifyRes)

    expect(result.success).toBe(true)
    expect(result.user).toBeDefined()
    expect(result.token).toBeDefined()
  })

  it('отклоняет неверный код и уменьшает attemptsLeft', async () => {
    await registerUser(USER_DATA)
    const res = mockRes()
    const login = await loginUser(USER_DATA.email, USER_DATA.password, res)

    await send2FACodeService(login.userId!)
    const verifyRes = mockRes()

    const result = await verify2FACodeService(login.userId!, '000000', verifyRes)
    expect(result.success).toBe(false)
    expect(result.attemptsLeft).toBe(2)
  })

  it('блокирует после 3 неверных попыток', async () => {
    await registerUser(USER_DATA)
    const res = mockRes()
    const login = await loginUser(USER_DATA.email, USER_DATA.password, res)

    // Отправляем код один раз — пытаемся ввести неверно 3 раза
    await send2FACodeService(login.userId!)

    for (let i = 0; i < 3; i++) {
      const vr = await verify2FACodeService(login.userId!, '000000', mockRes())
      if (i === 2) {
        expect(vr.locked).toBe(true)
        expect(vr.timeLeft).toBeGreaterThan(0)
      } else {
        expect(vr.attemptsLeft).toBe(2 - i)
      }
    }
  })

  it('отклоняет истёкший код', async () => {
    await registerUser(USER_DATA)
    const res = mockRes()
    const login = await loginUser(USER_DATA.email, USER_DATA.password, res)

    await send2FACodeService(login.userId!)

    // Протухаем код вручную
    const { prisma } = await import('../../src/config/db.js')
    await prisma.user.update({
      where: { id: login.userId! },
      data: { twoFactorCodeExpiresAt: new Date(Date.now() - 1000) },
    })

    const result = await verify2FACodeService(login.userId!, '000000', mockRes())
    expect(result.success).toBe(false)
    expect(result.message).toContain('истёк')
  })
})
