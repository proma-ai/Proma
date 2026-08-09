import { describe, expect, it } from 'bun:test'
import { canSubmitWithLegalAcceptance } from './legal-agreement'

describe('canSubmitWithLegalAcceptance', () => {
  it('已同意时允许提交', () => {
    expect(canSubmitWithLegalAcceptance(true)).toBe(true)
  })

  it('未同意时阻止提交', () => {
    expect(canSubmitWithLegalAcceptance(false)).toBe(false)
  })
})
