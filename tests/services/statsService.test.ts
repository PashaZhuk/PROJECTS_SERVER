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

const { getOnlineUsersFromSockets, setIo, getIo } = await import('../../src/services/statsService.js')

describe('statsService — online-статусы', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setIo(null as any)
  })

  describe('getOnlineUsersFromSockets', () => {
    it('возвращает нули, если io не установлен', () => {
      const result = getOnlineUsersFromSockets()
      expect(result).toEqual({ onlineUsers: 0, onlineManagers: 0, onlineUserNames: [], onlineManagerNames: [] })
    })

    it('считает уникальных USER и MANAGER, игнорирует ADMIN', () => {
      const mockSockets = new Map([
        ['s1', { data: { userId: 1, userRole: 'USER', user: { companyName: 'ООО А', name: null } } }],
        ['s2', { data: { userId: 1, userRole: 'USER', user: { companyName: 'ООО А', name: null } } }], // дубликат
        ['s3', { data: { userId: 2, userRole: 'MANAGER', user: { companyName: null, name: 'Менеджер' } } }],
        ['s4', { data: { userId: 3, userRole: 'ADMIN', user: { companyName: null, name: 'Админ' } } }], // игнор
      ])
      const mockIo = { sockets: { sockets: mockSockets } }
      setIo(mockIo as any)

      const result = getOnlineUsersFromSockets()
      expect(result.onlineUsers).toBe(1)
      expect(result.onlineManagers).toBe(1)
      expect(result.onlineUserNames).toEqual(['ООО А'])
      expect(result.onlineManagerNames).toEqual(['Менеджер'])
    })

    it('не добавляет пустые имена', () => {
      const mockSockets = new Map([
        ['s1', { data: { userId: 1, userRole: 'USER', user: { companyName: null, name: null } } }],
      ])
      const mockIo = { sockets: { sockets: mockSockets } }
      setIo(mockIo as any)

      const result = getOnlineUsersFromSockets()
      expect(result.onlineUsers).toBe(1)
      expect(result.onlineUserNames).toEqual([])
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