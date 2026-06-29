import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../src/services/statsService.js', () => ({
  emitStatsUpdate: vi.fn(),
  getIo: vi.fn(() => null),
  getOnlineUsersFromSockets: vi.fn(() => ({ onlineUsers: 0, onlineManagers: 0 })),
}))

const { registerUser } = await import('../../src/services/authService.js')
const { getUsersList, deleteUserById, toggleBlockUser, changeUserPassword } =
  await import('../../src/services/userService.js')
const { AppError } = await import('../../src/utils/AppError.js')
const { prisma } = await import('../../src/config/db.js')

const USER_DATA = {
  email: 'u-test@test.com', password: 'Pass123!', role: 'USER' as const,
  companyName: 'ООО Юзер', unp: '111222334', phone: '+375291234501',
}
const MANAGER_DATA = {
  email: 'm-test@test.com', password: 'Pass123!', role: 'MANAGER' as const, name: 'Менеджер Тест',
  phone: '+375****4501',
}

let userId: number
let managerId: number

beforeEach(async () => {
  vi.clearAllMocks()
  const u = await registerUser(USER_DATA)
  userId = u.id
  const m = await registerUser(MANAGER_DATA)
  managerId = m.id
})

describe('getUsersList', () => {
  it('возвращает пользователей без ADMIN', async () => {
    const result = await getUsersList({ page: 1, limit: 10, search: '', role: '' })
    expect(result.users.length).toBe(2) // USER + MANAGER, не ADMIN
    expect(result.users.every((u: any) => u.role !== 'ADMIN')).toBe(true)
  })

  it('фильтрует по роли', async () => {
    const result = await getUsersList({ page: 1, limit: 10, search: '', role: 'USER' })
    expect(result.users.length).toBe(1)
    expect(result.users[0]!.role).toBe('USER')
  })

  it('ищет по email', async () => {
    const result = await getUsersList({ page: 1, limit: 10, search: 'm-test', role: '' })
    expect(result.users.length).toBe(1)
    expect(result.users[0]!.email).toBe(MANAGER_DATA.email)
  })
})

describe('deleteUserById', () => {
  it('удаляет пользователя', async () => {
    await deleteUserById(userId, managerId)
    const user = await prisma.user.findUnique({ where: { id: userId } })
    expect(user).toBeNull()
  })

  it('запрещает удалять себя', async () => {
    await expect(deleteUserById(userId, userId)).rejects.toThrow(AppError)
  })

  it('возвращает 404 если пользователь не найден', async () => {
    await expect(deleteUserById(99999, managerId)).rejects.toThrow(AppError)
  })
})

describe('toggleBlockUser', () => {
  it('блокирует пользователя', async () => {
    const result = await toggleBlockUser(userId, managerId)
    expect(result.isBlocked).toBe(true)
    expect(result.message).toContain('заблокирован')

    const user = await prisma.user.findUnique({ where: { id: userId } })
    expect(user!.isBlocked).toBe(true)
  })

  it('разблокирует пользователя', async () => {
    await toggleBlockUser(userId, managerId)
    const result = await toggleBlockUser(userId, managerId)
    expect(result.isBlocked).toBe(false)
  })

  it('запрещает блокировать себя', async () => {
    await expect(toggleBlockUser(userId, userId)).rejects.toThrow(AppError)
  })

  it('снимает системную блокировку пароля', async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { lockUntil: new Date(Date.now() + 3600000), failedLoginAttempts: 5 },
    })
    const result = await toggleBlockUser(userId, managerId)
    expect(result.isBlocked).toBe(false)
    expect(result.message).toContain('блокировка входа')
  })
})

describe('changeUserPassword', () => {
  it('меняет пароль и сбрасывает mustChangePassword', async () => {
    await changeUserPassword(userId, 'NewPass123!')
    const user = await prisma.user.findUnique({ where: { id: userId } })
    expect(user!.mustChangePassword).toBe(false)
    // Пароль должен быть захэширован
    expect(user!.password).not.toBe('NewPass123!')
  })
})
