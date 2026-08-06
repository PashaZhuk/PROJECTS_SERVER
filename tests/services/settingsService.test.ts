import { describe, it, expect, beforeEach, vi } from 'vitest'

// Мокаем prisma
const { mockFindUnique, mockFindMany, mockUpsert } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockFindMany: vi.fn(),
  mockUpsert: vi.fn(),
}))

vi.mock('../../src/config/db.js', () => ({
  prisma: {
    siteSetting: {
      findUnique: mockFindUnique,
      findMany: mockFindMany,
      upsert: mockUpsert,
    },
  },
}))

const { getSetting, getAllSettings, upsertSetting } = await import('../../src/services/settingsService.js')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('settingsService', () => {
  describe('getSetting', () => {
    it('возвращает значение настройки', async () => {
      mockFindUnique.mockResolvedValue({ key: 'companyName', value: 'АйПиМатика' })
      const result = await getSetting('companyName')
      expect(result).toBe('АйПиМатика')
      expect(mockFindUnique).toHaveBeenCalledWith({ where: { key: 'companyName' } })
    })

    it('возвращает null если настройка не найдена', async () => {
      mockFindUnique.mockResolvedValue(null)
      const result = await getSetting('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('getAllSettings', () => {
    it('возвращает объект со всеми настройками', async () => {
      mockFindMany.mockResolvedValue([
        { key: 'companyName', value: 'АйПиМатика' },
        { key: 'phone', value: '+375291234567' },
      ])
      const result = await getAllSettings()
      expect(result).toEqual({
        companyName: 'АйПиМатика',
        phone: '+375291234567',
      })
    })

    it('возвращает пустой объект если настроек нет', async () => {
      mockFindMany.mockResolvedValue([])
      const result = await getAllSettings()
      expect(result).toEqual({})
    })
  })

  describe('upsertSetting', () => {
    it('создаёт настройку если её нет', async () => {
      mockUpsert.mockResolvedValue({ key: 'motto', value: 'Тестовый лозунг' })
      const result = await upsertSetting('motto', 'Тестовый лозунг')
      expect(result).toBe('Тестовый лозунг')
      expect(mockUpsert).toHaveBeenCalledWith({
        where: { key: 'motto' },
        create: { key: 'motto', value: 'Тестовый лозунг' },
        update: { value: 'Тестовый лозунг' },
      })
    })

    it('обновляет настройку если она существует', async () => {
      mockUpsert.mockResolvedValue({ key: 'motto', value: 'Новый лозунг' })
      const result = await upsertSetting('motto', 'Новый лозунг')
      expect(result).toBe('Новый лозунг')
    })
  })
})
