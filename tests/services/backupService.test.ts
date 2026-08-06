import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockValidate, mockSchedule } = vi.hoisted(() => ({
  mockValidate: vi.fn(),
  mockSchedule: vi.fn(() => ({ stop: vi.fn() })),
}))

// Мокаем node-cron — setSchedule использует cron.validate и cron.schedule.
// В ESM node-cron экспортирует default-объект.
vi.mock('node-cron', () => ({
  default: {
    validate: mockValidate,
    schedule: mockSchedule,
  },
  validate: mockValidate,
  schedule: mockSchedule,
}))

// Мокаем fs/promises — restoreBackup использует fs.access и fs.mkdir
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    access: vi.fn(),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
  }
})

const { restoreBackup, setSchedule } = await import('../../src/services/backupService.js')
const fs = await import('fs/promises')

describe('backupService — валидация (B28)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(fs.mkdir as any).mockResolvedValue(undefined)
  })

  describe('restoreBackup — защита от directory traversal', () => {
    it('отклоняет filename с ".."', async () => {
      const result = await restoreBackup('../etc/passwd')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Некорректное имя файла')
    })

    it('отклоняет filename с "/"', async () => {
      const result = await restoreBackup('sub/backup.sql')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Некорректное имя файла')
    })

    it('отклоняет filename с "\\"', async () => {
      const result = await restoreBackup('..\\backup.sql')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Некорректное имя файла')
    })

    it('отклоняет пустой filename', async () => {
      const result = await restoreBackup('')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Некорректное имя файла')
    })

    it('валидный filename, но файл не существует → ошибка файла', async () => {
      ;(fs.access as any).mockRejectedValue(new Error('ENOENT'))
      const result = await restoreBackup('backup_2026-01-01_00-00-00.sql')
      expect(result.success).toBe(false)
      expect(result.error).toContain('не найден')
    })
  })

  describe('setSchedule — валидация cron-выражения', () => {
    it('принимает валидное cron-выражение', () => {
      mockValidate.mockReturnValue(true)
      mockSchedule.mockReturnValue({ stop: vi.fn() })

      const result = setSchedule('0 3 * * *')
      expect(result.success).toBe(true)
      expect(mockSchedule).toHaveBeenCalledWith('0 3 * * *', expect.any(Function))
    })

    it('отклоняет невалидное cron-выражение', () => {
      mockValidate.mockReturnValue(false)

      const result = setSchedule('not-a-cron')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Некорректное cron-выражение')
      expect(mockSchedule).not.toHaveBeenCalled()
    })

    it('пустое выражение отключает расписание', () => {
      const result = setSchedule('')
      expect(result.success).toBe(true)
      expect(mockSchedule).not.toHaveBeenCalled()
    })
  })
})