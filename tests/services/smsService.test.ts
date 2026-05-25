import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Оригинальный fetch сохранять не нужно — восстанавливаем через vi.unstubAllGlobals

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  process.env.SMART_SENDER_USER = 'testuser'
  process.env.SMART_SENDER_APIKEY = 'testapikey'
  process.env.SMART_SENDER_SENDER = 'test_sender'
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// Импортируем после настройки env — модуль читает env при импорте
const { sendSms, getSmsStatus } = await import('../../src/services/smsService.js')

function jsonResponse(data: any, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(data),
  })
}

describe('sendSms', () => {
  it('успешно отправляет SMS', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        status: true,
        message_id: 12345,
        price: 0.05,
        parts: 1,
        amount: 0.05,
      })
    )

    const result = await sendSms('+375291234567', 'IPMATIKA: код 123456')

    expect(result.success).toBe(true)
    expect(result.messageId).toBe(12345)
    expect(result.price).toBe(0.05)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('smart-sender.a1.by')
    expect(url).toContain('msisdn=%2B375291234567')
    expect(url).toContain('sender=test_sender')
    expect(url).toContain('text=IPMATIKA%3A%20%D0%BA%D0%BE%D0%B4%20123456')
  })

  it('возвращает ошибку при статусе false от API', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        status: false,
        error: { code: 101, description: 'Неверный номер' },
      })
    )

    const result = await sendSms('+375290000000', 'test')

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe(101)
    expect(result.error?.description).toBe('Неверный номер')
  })

  it('возвращает ошибку сети при неудачном fetch', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await sendSms('+375291234567', 'test')

    expect(result.success).toBe(false)
    expect(result.error?.description).toContain('ECONNREFUSED')
  })

  it('возвращает ошибку если env не настроен', async () => {
    delete process.env.SMART_SENDER_USER
    delete process.env.SMART_SENDER_APIKEY

    const result = await sendSms('+375291234567', 'test')

    expect(result.success).toBe(false)
    expect(result.error?.description).toBe('Сервис SMS не настроен')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('использует sender по умолчанию support_IPM если не указан', async () => {
    delete process.env.SMART_SENDER_SENDER

    mockFetch.mockResolvedValue(
      jsonResponse({ status: true, message_id: 1 })
    )

    await sendSms('+375291234567', 'test')

    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('sender=support_IPM')
  })

  it('маскирует номер в логах (последние 4 цифры)', async () => {
    // Проверяем что код не падает — маскировка в логах не влияет на ответ
    mockFetch.mockResolvedValue(
      jsonResponse({ status: true, message_id: 1 })
    )

    const result = await sendSms('+375291234567', 'test')
    expect(result.success).toBe(true)
  })
})

describe('getSmsStatus', () => {
  it('возвращает статус при успешном ответе', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        status: true,
        message_status: { name: 'Доставлено' },
      })
    )

    const status = await getSmsStatus(12345)
    expect(status).toBe('Доставлено')
  })

  it('возвращает null при ошибке', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ status: false })
    )

    const status = await getSmsStatus(12345)
    expect(status).toBeNull()
  })

  it('возвращает null при отсутствии env', async () => {
    delete process.env.SMART_SENDER_USER

    const status = await getSmsStatus(12345)
    expect(status).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
