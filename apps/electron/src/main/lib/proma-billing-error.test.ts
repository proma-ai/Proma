import { describe, expect, test } from 'bun:test'
import { isPromaBillingErrorText } from './proma-billing-error'

describe('Proma billing error text fallback', () => {
  test.each([
    'upstream returned insufficient_quota',
    'payment_required: please recharge',
    '余额不足，请充值后重试',
    '积分不足',
  ])('Given a Proma quota error text When classifying Then detects billing error: %s', (message) => {
    expect(isPromaBillingErrorText(message)).toBe(true)
  })

  test.each([
    'HTTP 500 upstream temporarily unavailable',
    'invalid_api_key',
    'model_not_found',
    '余额校验完成',
  ])('Given a non-billing error text When classifying Then does not misclassify it: %s', (message) => {
    expect(isPromaBillingErrorText(message)).toBe(false)
  })
})
