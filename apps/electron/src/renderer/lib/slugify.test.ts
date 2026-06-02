import { describe, expect, test } from 'bun:test'
import { createSlugger, slugify } from './slugify'

describe('slugify', () => {
  test('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  test('strips punctuation but keeps alphanumerics', () => {
    expect(slugify('What is TOC? (overview)')).toBe('what-is-toc-overview')
  })

  test('preserves CJK characters', () => {
    expect(slugify('目录导航 设计')).toBe('目录导航-设计')
  })

  test('collapses repeated and trims edge hyphens', () => {
    expect(slugify('  --foo   bar--  ')).toBe('foo-bar')
  })

  test('returns empty string for punctuation-only input', () => {
    expect(slugify('!!!')).toBe('')
  })
})

describe('createSlugger', () => {
  test('appends incrementing suffixes for duplicates', () => {
    const slug = createSlugger()
    expect(slug('Intro')).toBe('intro')
    expect(slug('Intro')).toBe('intro-1')
    expect(slug('Intro')).toBe('intro-2')
  })

  test('falls back to "section" for empty slugs', () => {
    const slug = createSlugger()
    expect(slug('???')).toBe('section')
    expect(slug('***')).toBe('section-1')
  })
})
