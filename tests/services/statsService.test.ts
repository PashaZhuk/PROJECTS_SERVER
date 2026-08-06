import { describe, it, expect, vi, beforeEach } from 'vitest'

// Мокаем prisma — statsService использует его в fetchStatsInternal
vi.mock('../../src/config/db.js', () => ({
  prisma: {
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

const { getOnlineUsersFromSockets, setIo, getIo, registerSocket, unregisterSocket, clearOnlineUsersMap } = await import('../../src/services/statsService.js')

describe('statsService — online-статусы', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setIo(null as any)
    clearOnlineUsersMap()
  })

  describe('getOnlineUsersFromSockets', () => {
    it('возвращает нули, если нет зарегистрированных сокетов', () => {
      const result = getOnlineUsersFromSockets()
      expect(result).toEqual({ onlineUsers: 0, onlineManagers: 0, onlineUserNames: [], onlineManagerNames: [] })
    })

    it('считает уникальных USER и MANAGER, игнорирует ADMIN', () => {
      // B8: используем registerSocket вместо моков io.sockets
      registerSocket('s1', 1, 'USER', 'ООО А')
      registerSocket('s2', 1, 'USER', 'ООО А') // дубликат — тот же userId
      registerSocket('s3', 2, 'MANAGER', 'Менеджер')
      registerSocket('s4', 3, 'ADMIN', 'Админ') // игнор

      const result = getOnlineUsersFromSockets()
      expect(result.onlineUsers).toBe(1)
      expect(result.onlineManagers).toBe(1)
      expect(result.onlineUserNames).toEqual(['ООО А'])
      expect(result.onlineManagerNames).toEqual(['Менеджер'])
    })

    it('не добавляет пустые имена', () => {
      registerSocket('s1', 1, 'USER', '')

      const result = getOnlineUsersFromSockets()
      expect(result.onlineUsers).toBe(1)
      expect(result.onlineUserNames).toEqual([])
    })

    it('удаляет пользователя из Map при unregister последнего сокета', () => {
      registerSocket('s1', 1, 'USER', 'ООО А')
      registerSocket('s2', 1, 'USER', 'ООО А')
      expect(getOnlineUsersFromSockets().onlineUsers).toBe(1)

      unregisterSocket('s1', 1)
      expect(getOnlineUsersFromSockets().onlineUsers).toBe(1) // ещё есть s2

      unregisterSocket('s2', 1)
      expect(getOnlineUsersFromSockets().onlineUsers).toBe(0) // все сокеты ушли
    })
  })

  describe('getIo/setIo', () => {
    it('setIo сохраняет и getIo возвращает экземпляр', () => {
      const mockIo = { test: true }
      setIo(mockIo as any)
      expect(getIo()).toBe(mockIo)
    })
  })
})
