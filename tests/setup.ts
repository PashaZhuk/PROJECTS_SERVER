// Устанавливаем env до любых импортов — иначе dotenv перетрёт из .env файла
process.env.DATABASE_URL =
  'postgresql://admin:testpass@127.0.0.1:5433/b2b_portal_test?schema=public'
process.env.JWT_SECRET = 'test-secret-key-for-tests'
process.env.NODE_ENV = 'test'
process.env.SMTP_HOST = 'localhost'
process.env.SMTP_PORT = '1025'
process.env.SMTP_SECURE = 'false'
process.env.SMTP_USER = 'test@test.com'
process.env.SMTP_PASS = 'test'

import { beforeAll, afterAll, afterEach, vi } from 'vitest'
import { prisma, disconnectDB } from '../src/config/db.js'

// Мокаем отправку email — в тестах SMTP не нужен
vi.mock('../src/services/emailService.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  generateResetPasswordEmail: vi.fn().mockReturnValue(''),
  generateWelcomeEmail: vi.fn().mockReturnValue(''),
}))

// Очистка всех таблиц между тестами
export async function cleanDb() {
  const tablenames = await prisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public'`

  const tables = tablenames
    .map((r) => r.tablename)
    .filter((name) => name !== '_prisma_migrations')
    .map((name) => `"public"."${name}"`)
    .join(', ')

  if (tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE`)
  }
}

beforeAll(async () => {
  await prisma.$connect()
})

afterEach(async () => {
  await cleanDb()
})

afterAll(async () => {
  await disconnectDB()
})
