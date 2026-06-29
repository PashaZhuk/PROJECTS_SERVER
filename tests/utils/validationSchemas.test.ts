import { describe, it, expect } from 'vitest'

const {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  twoFASendSchema,
  twoFAVerifySchema,
  createProjectSchema,
  updateProjectSchema,
  updateProjectStatusSchema,
  sendMessageSchema,
  broadcastSchema,
  changePasswordSchema,
} = await import('../../src/utils/validationSchemas.js')

const safeParse = (schema: any, data: any) => {
  const result = schema.safeParse(data)
  return { success: result.success, errors: result.error?.issues?.map((i: any) => i.path.join('.') + ': ' + i.message) || [] }
}

describe('loginSchema', () => {
  it('валидирует корректные данные', () => {
    const r = safeParse(loginSchema, { email: 'test@test.com', password: '123456' })
    expect(r.success).toBe(true)
  })

  it('отклоняет неверный email', () => {
    const r = safeParse(loginSchema, { email: 'invalid', password: '123456' })
    expect(r.success).toBe(false)
  })

  it('отклоняет пустой пароль', () => {
    const r = safeParse(loginSchema, { email: 'test@test.com', password: '' })
    expect(r.success).toBe(false)
  })
})

describe('registerSchema', () => {
  it('валидирует USER с companyName, unp, phone', () => {
    const r = safeParse(registerSchema, {
      email: 'user@test.com', password: '123456', role: 'USER',
      companyName: 'ООО Тест', unp: '123456789', phone: '+375291234567',
    })
    expect(r.success).toBe(true)
  })

  it('валидирует MANAGER с name и phone', () => {
    const r = safeParse(registerSchema, {
      email: 'mgr@test.com', password: '123456', role: 'MANAGER', name: 'Иван',
      phone: '+375291234567',
    })
    expect(r.success).toBe(true)
  })

  it('отклоняет MANAGER без name', () => {
    const r = safeParse(registerSchema, {
      email: 'mgr@test.com', password: '123456', role: 'MANAGER',
    })
    expect(r.success).toBe(false)
  })

  it('отклоняет USER без companyName', () => {
    const r = safeParse(registerSchema, {
      email: 'user@test.com', password: '123456', role: 'USER',
    })
    expect(r.success).toBe(false)
  })

  it('отклоняет слабый пароль (< 6 символов)', () => {
    const r = safeParse(registerSchema, {
      email: 'user@test.com', password: '12345', role: 'USER',
      companyName: 'ООО', unp: '123', phone: '+37529',
    })
    expect(r.success).toBe(false)
  })
})

describe('twoFASendSchema', () => {
  it('валидирует userId как число', () => {
    expect(safeParse(twoFASendSchema, { userId: 1 }).success).toBe(true)
  })

  it('отклоняет userId не число', () => {
    expect(safeParse(twoFASendSchema, { userId: 'abc' }).success).toBe(false)
  })
})

describe('twoFAVerifySchema', () => {
  it('валидирует userId + code', () => {
    expect(safeParse(twoFAVerifySchema, { userId: 1, code: '123456' }).success).toBe(true)
  })

  it('отклоняет короткий код', () => {
    expect(safeParse(twoFAVerifySchema, { userId: 1, code: '123' }).success).toBe(false)
  })
})

describe('forgotPasswordSchema', () => {
  it('валидирует email', () => {
    expect(safeParse(forgotPasswordSchema, { email: 'test@test.com' }).success).toBe(true)
  })

  it('отклоняет пустой email', () => {
    expect(safeParse(forgotPasswordSchema, { email: '' }).success).toBe(false)
  })
})

describe('resetPasswordSchema', () => {
  it('валидирует token + newPassword', () => {
    expect(safeParse(resetPasswordSchema, { token: '550e8400-e29b-41d4-a716-446655440000', newPassword: '123456' }).success).toBe(true)
  })

  it('отклоняет короткий пароль', () => {
    expect(safeParse(resetPasswordSchema, { token: 'abc', newPassword: '12' }).success).toBe(false)
  })
})

describe('createProjectSchema', () => {
  it('валидирует with customerInn', () => {
    const r = safeParse(createProjectSchema, { formType: 'type1', customerName: 'Клиент', customerInn: '123456789' })
    expect(r.success).toBe(true)
  })

  it('отклоняет без formType', () => {
    const r = safeParse(createProjectSchema, { customerName: 'Клиент' })
    expect(r.success).toBe(false)
  })
})

describe('updateProjectStatusSchema', () => {
  it('валидирует статус', () => {
    expect(safeParse(updateProjectStatusSchema, { status: 'APPROVED' }).success).toBe(true)
  })

  it('отклоняет невалидный статус', () => {
    expect(safeParse(updateProjectStatusSchema, { status: 'INVALID' }).success).toBe(false)
  })
})

describe('sendMessageSchema', () => {
  it('валидирует text', () => {
    expect(safeParse(sendMessageSchema, { text: 'Привет' }).success).toBe(true)
  })

  it('отклоняет пустой text', () => {
    expect(safeParse(sendMessageSchema, { text: '' }).success).toBe(false)
  })
})

describe('changePasswordSchema', () => {
  it('валидирует currentPassword + newPassword', () => {
    const r = safeParse(changePasswordSchema, { currentPassword: 'old', newPassword: 'new123' })
    expect(r.success).toBe(true)
  })

  it('отклоняет короткий новый пароль', () => {
    const r = safeParse(changePasswordSchema, { currentPassword: 'old', newPassword: 'new' })
    expect(r.success).toBe(false)
  })
})
