import { describe, expect, test } from 'bun:test'
import { CURRENT_ONBOARDING_VERSION, hasCompletedCurrentOnboarding, isSidebarCreditIndicatorVisible } from './settings'

describe('侧边栏余额常驻显示', () => {
  test('Given a legacy installation without this preference When checking visibility Then the indicator remains visible', () => {
    expect(isSidebarCreditIndicatorVisible({})).toBe(true)
  })

  test('Given a user has enabled the preference When checking visibility Then the indicator is visible', () => {
    expect(isSidebarCreditIndicatorVisible({ sidebarCreditIndicatorVisible: true })).toBe(true)
  })

  test('Given a user has disabled the preference When checking visibility Then the indicator is hidden', () => {
    expect(isSidebarCreditIndicatorVisible({ sidebarCreditIndicatorVisible: false })).toBe(false)
  })
})

describe('Onboarding completion version', () => {
  test('Given an existing completed installation without a version When checking Then requires the new onboarding', () => {
    expect(hasCompletedCurrentOnboarding({ onboardingCompleted: true })).toBe(false)
  })

  test('Given the current version is completed When checking Then does not show onboarding again', () => {
    expect(hasCompletedCurrentOnboarding({
      onboardingCompleted: true,
      onboardingVersion: CURRENT_ONBOARDING_VERSION,
    })).toBe(true)
  })

  test('Given a newer version is completed When checking after a rollback Then does not show an older onboarding', () => {
    expect(hasCompletedCurrentOnboarding({
      onboardingCompleted: true,
      onboardingVersion: CURRENT_ONBOARDING_VERSION + 1,
    })).toBe(true)
  })

  test('Given the current version is not completed When checking Then shows onboarding', () => {
    expect(hasCompletedCurrentOnboarding({
      onboardingCompleted: false,
      onboardingVersion: CURRENT_ONBOARDING_VERSION,
    })).toBe(false)
  })
})
