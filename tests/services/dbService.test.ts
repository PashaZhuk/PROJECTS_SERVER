import { describe, it, expect, beforeEach, vi } from 'vitest'

// Мокаем prisma — dbService использует $queryRawUnsafe и $executeRawUnsafe
const { mockQueryRawUnsafe, mockExecuteRawUnsafe } = vi.hoisted(() => ({
  mockQueryRawUnsafe: vi.fn(),
  mockExecuteRawUnsafe: vi.fn(),
}))

vi.mock('../../src/config/db.js', () => ({
  prisma: {
    $queryRawUnsafe: mockQueryRawUnsafe,
    $executeRawUnsafe: mockExecuteRawUnsafe,
  },
}))

const { getTables, getTableData, updateTableRow } = await import('../../src/services/dbService.js')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('dbService', () => {
  describe('getTables', () => {
    it('возвращает список разрешённых таблиц с колонками', async () => {
      mockQueryRawUnsafe.mockResolvedValue([
        { column_name: 'id', data_type: 'integer', is_nullable: 'NO', is_pk: true },
        { column_name: 'name', data_type: 'character varying', is_nullable: 'YES', is_pk: false },
      ])

      const result = await getTables()
      expect(result.length).toBe(4) // Company, User, Project, Message
      expect(result[0]!.name).toBe('Company')
      expect(result[0]!.columns[0]).toEqual({
        name: 'id',
        type: 'integer',
        nullable: false,
        isPk: true,
        readOnly: false,
      })
    })
  })

  describe('getTableData', () => {
    it('возвращает данные таблицы с пагинацией', async () => {
      mockQueryRawUnsafe
        .mockResolvedValueOnce([{ column_name: 'id', data_type: 'integer', is_nullable: 'NO', is_pk: true }])
        .mockResolvedValueOnce([{ count: 2n }])
        .mockResolvedValueOnce([{ id: 1, name: 'Тест' }, { id: 2, name: 'Тест2' }])

      const result = await getTableData('User', { page: 1, perPage: 10 })
      expect(result.total).toBe(2)
      expect(result.data.length).toBe(2)
      expect(result.page).toBe(1)
      expect(result.perPage).toBe(10)
    })

    it('ограничивает perPage до 100', async () => {
      mockQueryRawUnsafe
        .mockResolvedValueOnce([{ column_name: 'id', data_type: 'integer', is_nullable: 'NO', is_pk: true }])
        .mockResolvedValueOnce([{ count: 0n }])
        .mockResolvedValueOnce([])

      const result = await getTableData('User', { page: 1, perPage: 500 })
      expect(result.perPage).toBe(100)
    })

    it('отклоняет неразрешённую таблицу', async () => {
      await expect(getTableData('Hackers', {})).rejects.toThrow('not allowed')
    })
  })

  describe('updateTableRow', () => {
    it('обновляет строку в таблице', async () => {
      mockQueryRawUnsafe.mockResolvedValue([
        { column_name: 'id', data_type: 'integer', is_nullable: 'NO', is_pk: true },
        { column_name: 'name', data_type: 'character varying', is_nullable: 'YES', is_pk: false },
      ])
      mockExecuteRawUnsafe.mockResolvedValue(1)

      await updateTableRow('User', 1, { name: 'Новое имя' })
      expect(mockExecuteRawUnsafe).toHaveBeenCalled()
    })

    it('не обновляет read-only поля', async () => {
      mockQueryRawUnsafe.mockResolvedValue([
        { column_name: 'id', data_type: 'integer', is_nullable: 'NO', is_pk: true },
        { column_name: 'password', data_type: 'character varying', is_nullable: 'YES', is_pk: false },
        { column_name: 'name', data_type: 'character varying', is_nullable: 'YES', is_pk: false },
      ])
      mockExecuteRawUnsafe.mockResolvedValue(1)

      // password — read-only, name — обновляемое
      await updateTableRow('User', 1, { password: 'hacked', name: 'Иван' })
      expect(mockExecuteRawUnsafe).toHaveBeenCalled()
      const sql = mockExecuteRawUnsafe.mock.calls[0]![0] as string
      expect(sql).not.toContain('password')
      expect(sql).toContain('name')
    })

    it('отклоняет неразрешённую таблицу', async () => {
      await expect(updateTableRow('Hackers', 1, {})).rejects.toThrow('not allowed')
    })
  })
})
