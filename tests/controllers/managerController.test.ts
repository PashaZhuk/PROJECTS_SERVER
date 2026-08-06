import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFindMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
}))

// Мокаем зависимости managerController
vi.mock('../../src/config/db.js', () => ({
  prisma: {
    user: {
      findMany: mockFindMany,
    },
  },
}))

vi.mock('../../src/services/emailService.js', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('../../src/services/broadcastLogService.js', () => ({
  logBroadcast: vi.fn(),
}))

vi.mock('../../src/services/eventLogService.js', () => ({
  logEvent: vi.fn(),
}))

const { sendBroadcast } = await import('../../src/controllers/managerController.js')
const { sendEmail } = await import('../../src/services/emailService.js')

const mockRes = () => {
  const res: any = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn()
  return res
}

const mockNext = () => vi.fn()

describe('managerController — sendBroadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('отправляет рассылку получателям', async () => {
    const recipients = [
      { id: 1, email: 'user1@test.com', companyName: 'ООО 1' },
      { id: 2, email: 'user2@test.com', companyName: 'ООО 2' },
    ]
    mockFindMany.mockResolvedValue(recipients)
    ;(sendEmail as any).mockResolvedValue(true)

    const req: any = {
      body: { recipientIds: [1, 2], subject: 'Тема', message: 'Привет' },
      user: { id: 99, role: 'MANAGER' },
    }
    const res = mockRes()

    await sendBroadcast(req, res, mockNext())
    // asyncHandler не возвращает Promise — ждём завершения микротасков
    await new Promise(r => setTimeout(r, 0))

    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ sent: 2, failed: 0 }),
    }))
  })

  it('экранирует HTML в message (B16)', async () => {
    const recipients = [{ id: 1, email: 'user1@test.com', companyName: 'ООО 1' }]
    mockFindMany.mockResolvedValue(recipients)
    ;(sendEmail as any).mockResolvedValue(true)

    const req: any = {
      body: { recipientIds: [1], subject: 'Тема', message: '<script>alert(1)</script>Привет' },
      user: { id: 99, role: 'MANAGER' },
    }
    const res = mockRes()

    await sendBroadcast(req, res, mockNext())

    const htmlArg = (sendEmail as any).mock.calls[0][0].html
    expect(htmlArg).not.toContain('<script>')
    expect(htmlArg).toContain('Привет')
  })

  it('возвращает ошибку, если нет получателей', async () => {
    mockFindMany.mockResolvedValue([])

    const req: any = {
      body: { recipientIds: [1], subject: 'Тема', message: 'Привет' },
      user: { id: 99, role: 'MANAGER' },
    }
    const res = mockRes()

    await sendBroadcast(req, res, mockNext())

    expect(sendEmail).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
  })

  it('фиксирует ошибки отправки', async () => {
    const recipients = [
      { id: 1, email: 'user1@test.com', companyName: 'ООО 1' },
      { id: 2, email: 'user2@test.com', companyName: 'ООО 2' },
    ]
    mockFindMany.mockResolvedValue(recipients)
    ;(sendEmail as any)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('SMTP fail'))

    const req: any = {
      body: { recipientIds: [1, 2], subject: 'Тема', message: 'Привет' },
      user: { id: 99, role: 'MANAGER' },
    }
    const res = mockRes()

    await sendBroadcast(req, res, mockNext())
    // asyncHandler не возвращает Promise — ждём завершения микротасков
    await new Promise(r => setTimeout(r, 0))

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ sent: 1, failed: 1 }),
    }))
  })
})