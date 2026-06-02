import { describe, it, expect, beforeEach, vi } from 'vitest'
import { registerUser } from '../../src/services/authService.js'
import { AppError } from '../../src/utils/AppError.js'

// Мокаем eventLogService — он тянет prisma и логи
vi.mock('../../src/services/eventLogService.js', () => ({
  logEvent: vi.fn(),
}))

vi.mock('../../src/services/statsService.js', () => ({
  emitStatsUpdate: vi.fn(),
  getIo: vi.fn(() => null),
  getOnlineUsersFromSockets: vi.fn(() => ({ onlineUsers: 0, onlineManagers: 0 })),
}))

const { createProject, getProjects, updateProject, updateProjectStatus } =
  await import('../../src/services/projectService.js')

const USER_DATA = {
  email: 'p-user@test.com', password: 'Pass123!', role: 'USER' as const,
  companyName: 'ООО Партнёр', unp: '111222333', phone: '+375291111111',
}

const MANAGER_DATA = {
  email: 'p-mgr@test.com', password: 'Pass123!', role: 'MANAGER' as const, name: 'Менеджер',
}

let userId: number
let managerId: number

beforeEach(async () => {
  vi.clearAllMocks()
  const user = await registerUser(USER_DATA)
  userId = user.id
  const mgr = await registerUser(MANAGER_DATA)
  managerId = mgr.id
})

describe('createProject', () => {
  it('создаёт проект для USER', async () => {
    const project = await createProject(
      { formType: 'type1', customerName: 'ООО Заказчик', customerInn: '999888777' },
      userId,
    )

    expect(project.id).toBeGreaterThan(0)
    expect(project.status).toBe('PENDING')
    expect(project.partnerId).toBe(userId)
    expect(project.customerName).toBe('ООО Заказчик')
  })

  it('отклоняет дубликат customerInn для активного проекта', async () => {
    await createProject(
      { formType: 'type1', customerName: 'Первый', customerInn: '555444333' },
      userId,
    )

    await expect(
      createProject(
        { formType: 'type1', customerName: 'Второй', customerInn: '555444333' },
        userId,
      )
    ).rejects.toThrow(AppError)
  })

  it('позволяет создать проект с тем же УНП если старый CLOSED', async () => {
    const p1 = await createProject(
      { formType: 'type1', customerName: 'Старый', customerInn: '111222333' },
      userId,
    )

    // Закрываем проект
    const { prisma } = await import('../../src/config/db.js')
    await prisma.project.update({ where: { id: p1.id }, data: { status: 'CLOSED' as any } })

    const p2 = await createProject(
      { formType: 'type1', customerName: 'Новый', customerInn: '111222333' },
      userId,
    )
    expect(p2.id).toBeGreaterThan(p1.id)
  })
})

describe('getProjects', () => {
  it('USER видит только свои проекты', async () => {
    await createProject({ formType: 't1', customerName: 'A', customerInn: '111' }, userId)

    // Создаём второго пользователя
    const otherUser = await registerUser({
      email: 'other-p@test.com', password: 'Pass123!', role: 'USER' as const,
      companyName: 'Другой', unp: '999000111', phone: '+375292222222',
    })
    await createProject({ formType: 't1', customerName: 'B', customerInn: '222' }, otherUser.id)

    const result = await getProjects(userId, 'USER', { page: '1', limit: '10' })
    expect(result.projects.length).toBe(1)
    expect(result.totalCount).toBe(1)
  })

  it('MANAGER видит все проекты', async () => {
    await createProject({ formType: 't1', customerName: 'A', customerInn: '111' }, userId)

    const otherUser = await registerUser({
      email: 'other2@test.com', password: 'Pass123!', role: 'USER' as const,
      companyName: 'Другой2', unp: '999000222', phone: '+375293333333',
    })
    await createProject({ formType: 't1', customerName: 'B', customerInn: '222' }, otherUser.id)

    const result = await getProjects(managerId, 'MANAGER', { page: '1', limit: '10' })
    expect(result.projects.length).toBe(2)
  })
})

describe('updateProject', () => {
  it('USER может обновить свой проект', async () => {
    const p = await createProject(
      { formType: 't1', customerName: 'Старое имя', customerInn: '333' },
      userId,
    )
    const updated = await updateProject(p.id, { customerName: 'Новое имя' }, userId, 'USER')
    expect(updated.customerName).toBe('Новое имя')
  })

  it('USER не может обновить чужой проект', async () => {
    const otherUser = await registerUser({
      email: 'other3@test.com', password: 'Pass123!', role: 'USER' as const,
      companyName: 'Чужой', unp: '999000333', phone: '+375294444444',
    })
    const p = await createProject(
      { formType: 't1', customerName: 'Чужой', customerInn: '444' },
      otherUser.id,
    )
    await expect(
      updateProject(p.id, { customerName: 'Хакер' }, userId, 'USER')
    ).rejects.toThrow(AppError)
  })
})

describe('updateProjectStatus', () => {
  it('MANAGER может менять статус', async () => {
    const p = await createProject(
      { formType: 't1', customerName: 'Тест', customerInn: '555' },
      userId,
    )
    const updated = await updateProjectStatus(p.id, 'APPROVED', managerId, 'MANAGER')
    expect(updated.status).toBe('APPROVED')
  })

  it('USER не может менять статус', async () => {
    const p = await createProject(
      { formType: 't1', customerName: 'Тест2', customerInn: '666' },
      userId,
    )
    await expect(
      updateProjectStatus(p.id, 'APPROVED', userId, 'USER')
    ).rejects.toThrow(AppError)
  })

  it('отклоняет невалидный статус', async () => {
    const p = await createProject(
      { formType: 't1', customerName: 'Тест3', customerInn: '777' },
      userId,
    )
    await expect(
      updateProjectStatus(p.id, 'INVALID' as any, managerId, 'MANAGER')
    ).rejects.toThrow(AppError)
  })
})
