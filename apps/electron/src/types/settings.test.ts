import { describe, expect, test } from 'bun:test'
import { CURRENT_ONBOARDING_VERSION, hasCompletedCurrentOnboarding } from './settings'

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
