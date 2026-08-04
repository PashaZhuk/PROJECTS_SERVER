import { describe, it, expect, beforeEach, vi } from 'vitest'
import { registerUser } from '../../src/services/authService.js'
import { AppError } from '../../src/utils/AppError.js'

// Мокаем statsService — он тянет socket.io
vi.mock('../../src/services/statsService.js', () => ({
  emitStatsUpdate: vi.fn(),
  getIo: vi.fn(() => null),
  getOnlineUsersFromSockets: vi.fn(() => ({ onlineUsers: 0, onlineManagers: 0 })),
}))

// Мокаем eventLogService
vi.mock('../../src/services/eventLogService.js', () => ({
  logEvent: vi.fn(),
}))

const { createProject } = await import('../../src/services/projectService.js')
const { sendMessage, markMessagesAsRead, getProjectMessages } = await import('../../src/services/chatService.js')

const USER_DATA = {
  email: 'chat-user@test.com', password: 'Pass123!', role: 'USER' as const,
  companyName: 'ООО Чат', unp: '111222333', phone: '+375291111111',
}

const OTHER_USER_DATA = {
  email: 'chat-other@test.com', password: 'Pass123!', role: 'USER' as const,
  companyName: 'ООО Другой', unp: '999888777', phone: '+375292222222',
}

const MANAGER_DATA = {
  email: 'chat-mgr@test.com', password: 'Pass123!', role: 'MANAGER' as const,
  name: 'Менеджер Чата', phone: '+375293333333',
}

let userId: number
let otherUserId: number
let managerId: number

beforeEach(async () => {
  vi.clearAllMocks()
  const user = await registerUser(USER_DATA)
  userId = user.id
  const other = await registerUser(OTHER_USER_DATA)
  otherUserId = other.id
  const mgr = await registerUser(MANAGER_DATA)
  managerId = mgr.id
})

describe('chatService — IDOR-защита (B2/B3)', () => {
  describe('sendMessage', () => {
    it('USER может писать в свой проект', async () => {
      const project = await createProject(
        { formType: 't1', customerName: 'Заказчик', customerInn: '123456789' },
        userId,
      )
      const message = await sendMessage(project.id, 'Привет!', userId, 'USER')
      expect(message.id).toBeGreaterThan(0)
      expect(message.text).toBe('Привет!')
      expect(message.senderId).toBe(userId)
    })

    it('USER не может писать в чужой проект (403)', async () => {
      const project = await createProject(
        { formType: 't1', customerName: 'Заказчик', customerInn: '123456789' },
        userId,
      )
      await expect(
        sendMessage(project.id, 'Хакер!', otherUserId, 'USER')
      ).rejects.toThrow(AppError)
    })

    it('MANAGER может писать в любой проект', async () => {
      const project = await createProject(
        { formType: 't1', customerName: 'Заказчик', customerInn: '123456789' },
        userId,
      )
      const message = await sendMessage(project.id, 'Менеджер пишет', managerId, 'MANAGER')
      expect(message.id).toBeGreaterThan(0)
      expect(message.senderId).toBe(managerId)
    })

    it('отклоняет несуществующий проект (404)', async () => {
      await expect(
        sendMessage(999999, 'Текст', userId, 'USER')
      ).rejects.toThrow(AppError)
    })
  })

  describe('markMessagesAsRead', () => {
    it('USER может отметить прочитанными свои сообщения', async () => {
      const project = await createProject(
        { formType: 't1', customerName: 'Заказчик', customerInn: '123456789' },
        userId,
      )
      // Менеджер отправляет сообщение
      await sendMessage(project.id, 'Привет от менеджера', managerId, 'MANAGER')
      // USER отмечает прочитанным
      const result = await markMessagesAsRead(project.id, userId, 'USER')
      expect(result.success).toBe(true)
      expect(result.updatedCount).toBeGreaterThan(0)
    })

    it('USER не может отметить прочитанными чужие сообщения (403)', async () => {
      const project = await createProject(
        { formType: 't1', customerName: 'Заказчик', customerInn: '123456789' },
        userId,
      )
      await sendMessage(project.id, 'Привет от менеджера', managerId, 'MANAGER')
      await expect(
        markMessagesAsRead(project.id, otherUserId, 'USER')
      ).rejects.toThrow(AppError)
    })

    it('MANAGER может отметить прочитанными любые сообщения', async () => {
      const project = await createProject(
        { formType: 't1', customerName: 'Заказчик', customerInn: '123456789' },
        userId,
      )
      // USER отправляет сообщение
      await sendMessage(project.id, 'Привет от юзера', userId, 'USER')
      // Менеджер отмечает прочитанным
      const result = await markMessagesAsRead(project.id, managerId, 'MANAGER')
      expect(result.success).toBe(true)
    })
  })

  describe('getProjectMessages', () => {
    it('USER может читать сообщения своего проекта', async () => {
      const project = await createProject(
        { formType: 't1', customerName: 'Заказчик', customerInn: '123456789' },
        userId,
      )
      await sendMessage(project.id, 'Сообщение 1', userId, 'USER')
      await sendMessage(project.id, 'Сообщение 2', managerId, 'MANAGER')

      const messages = await getProjectMessages(project.id, userId, 'USER')
      expect(messages.length).toBe(2)
    })

    it('USER не может читать чужие сообщения (403)', async () => {
      const project = await createProject(
        { formType: 't1', customerName: 'Заказчик', customerInn: '123456789' },
        userId,
      )
      await sendMessage(project.id, 'Секретное сообщение', userId, 'USER')

      await expect(
        getProjectMessages(project.id, otherUserId, 'USER')
      ).rejects.toThrow(AppError)
    })

    it('MANAGER может читать любые сообщения', async () => {
      const project = await createProject(
        { formType: 't1', customerName: 'Заказчик', customerInn: '123456789' },
        userId,
      )
      await sendMessage(project.id, 'Сообщение', userId, 'USER')

      const messages = await getProjectMessages(project.id, managerId, 'MANAGER')
      expect(messages.length).toBe(1)
    })
  })
})