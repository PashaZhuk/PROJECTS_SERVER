import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../src/services/statsService.js', () => ({
  emitStatsUpdate: vi.fn(),
  getIo: vi.fn(() => null),
  getOnlineUsersFromSockets: vi.fn(() => ({ onlineUsers: 0, onlineManagers: 0 })),
}))

const { getCompanies } = await import('../../src/services/companyService.js')
const { registerUser } = await import('../../src/services/authService.js')
const { prisma } = await import('../../src/config/db.js')

beforeEach(async () => {
  vi.clearAllMocks()
  // Seed a company
  await prisma.company.create({
    data: { name: 'ООО Тест', unp: '123456789', phone: '+375291234567' },
  })
  await prisma.company.create({
    data: { name: 'ООО Пример', unp: '987654321', phone: '+375297654321' },
  })
})

describe('getCompanies', () => {
  it('возвращает все компании', async () => {
    const companies = await getCompanies()
    expect(companies.length).toBe(2)
  })

  it('ищет по имени', async () => {
    const companies = await getCompanies('Тест')
    expect(companies.length).toBe(1)
    expect(companies[0].name).toBe('ООО Тест')
  })

  it('ищет по УНП', async () => {
    const companies = await getCompanies('987654321')
    expect(companies.length).toBe(1)
    expect(companies[0].unp).toBe('987654321')
  })

  it('возвращает только id, name, unp, phone', async () => {
    const companies = await getCompanies()
    const keys = Object.keys(companies[0])
    expect(keys).toEqual(['id', 'name', 'unp', 'phone'])
  })
})
