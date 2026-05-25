import { describe, it, expect, vi } from 'vitest'
import type { Response } from 'express'

const { sendSuccess, sendError } = await import('../../src/utils/response.js')

function mockRes() {
  const _status: number[] = []
  let _body: any = null
  return {
    status: (code: number) => {
      _status.push(code)
      return { json: (b: any) => { _body = b } }
    },
    getStatus: () => _status[_status.length - 1],
    getBody: () => _body,
  } as any
}

describe('sendSuccess', () => {
  it('отправляет success:true с data', () => {
    const res = mockRes()
    sendSuccess(res, { user: { id: 1 } })

    expect(res.getStatus()).toBe(200)
    expect(res.getBody()).toEqual({ success: true, data: { user: { id: 1 } } })
  })

  it('отправляет success:true с message', () => {
    const res = mockRes()
    sendSuccess(res, undefined, 'Успешно создано', 201)

    expect(res.getStatus()).toBe(201)
    expect(res.getBody()).toEqual({ success: true, message: 'Успешно создано' })
  })

  it('отправляет success:true с data и message', () => {
    const res = mockRes()
    sendSuccess(res, { id: 42 }, 'Готово')

    expect(res.getBody()).toEqual({ success: true, data: { id: 42 }, message: 'Готово' })
  })
})

describe('sendError', () => {
  it('отправляет success:false с ошибкой', () => {
    const res = mockRes()
    sendError(res, 400, 'Неверный запрос')

    expect(res.getStatus()).toBe(400)
    expect(res.getBody()).toEqual({ success: false, error: 'Неверный запрос' })
  })

  it('отправляет с extra полями', () => {
    const res = mockRes()
    sendError(res, 429, 'Слишком много', { timeLeft: 120, lockType: 'password' })

    expect(res.getBody()).toEqual({
      success: false, error: 'Слишком много',
      timeLeft: 120, lockType: 'password',
    })
  })
})
