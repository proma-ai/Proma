import { describe, test, expect } from 'bun:test'
import {
  parsePartialArtifactInputJson,
  parseArtifactCreateInput,
  parseArtifactEditInput,
  isArtifactToolName,
  isArtifactGuidelineToolName,
  ARTIFACT_CREATE_TOOL,
  ARTIFACT_EDIT_TOOL,
} from './artifact-contract'

describe('artifact-contract', () => {
  describe('isArtifactToolName', () => {
    test('recognizes create_artifact', () => {
      expect(isArtifactToolName(ARTIFACT_CREATE_TOOL)).toBe(true)
    })

    test('recognizes edit_artifact', () => {
      expect(isArtifactToolName(ARTIFACT_EDIT_TOOL)).toBe(true)
    })

    test('recognizes MCP-qualified names', () => {
      expect(isArtifactToolName(`mcp__artifact__${ARTIFACT_CREATE_TOOL}`)).toBe(true)
    })

    test('rejects unknown tool names', () => {
      expect(isArtifactToolName('read')).toBe(false)
    })
  })

  describe('isArtifactGuidelineToolName', () => {
    test('recognizes load_artifact_guidelines', () => {
      expect(isArtifactGuidelineToolName('load_artifact_guidelines')).toBe(true)
    })
  })

  describe('parsePartialArtifactInputJson', () => {
    test('parses valid JSON', () => {
      const result = parsePartialArtifactInputJson('{"title":"Hello","type":"code"}')
      expect(result).toEqual({ title: 'Hello', type: 'code' })
    })

    test('extracts title from partial JSON', () => {
      const result = parsePartialArtifactInputJson('"title":"My Chart","cont')
      expect(result?.title).toBe('My Chart')
    })

    test('extracts content from snake_case key', () => {
      const result = parsePartialArtifactInputJson('"content":"<svg><","type":"html"')
      expect(result?.content).toBe('<svg><')
    })

    test('returns undefined for empty input', () => {
      expect(parsePartialArtifactInputJson('')).toBeUndefined()
    })

    test('returns undefined for whitespace-only input', () => {
      expect(parsePartialArtifactInputJson('   ')).toBeUndefined()
    })
  })

  describe('parseArtifactCreateInput', () => {
    test('parses valid create_artifact input', () => {
      const result = parseArtifactCreateInput({
        title: 'My Chart',
        type: 'html',
        content: '<svg></svg>',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.title).toBe('My Chart')
        expect(result.type).toBe('html')
        expect(result.content).toBe('<svg></svg>')
      }
    })

    test('accepts widget_code as alias for content', () => {
      const result = parseArtifactCreateInput({
        title: 'Widget',
        widget_code: '<div/>',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.content).toBe('<div/>')
      }
    })

    test('defaults type to code', () => {
      const result = parseArtifactCreateInput({
        title: 'Code',
        content: 'console.log("hi")',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.type).toBe('code')
      }
    })

    test('fails on missing content', () => {
      const result = parseArtifactCreateInput({ title: 'Empty' })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('missing content')
      }
    })

    test('fails on oversized content', () => {
      const result = parseArtifactCreateInput({
        title: 'Huge',
        content: 'x'.repeat(200_000),
      })
      expect(result.ok).toBe(false)
    })
  })

  describe('parseArtifactEditInput', () => {
    test('parses valid edit_artifact input', () => {
      const result = parseArtifactEditInput({
        artifact_id: 'art-001',
        title: 'Updated Title',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.artifactId).toBe('art-001')
        expect(result.title).toBe('Updated Title')
      }
    })

    test('accepts artifactId as alias', () => {
      const result = parseArtifactEditInput({
        artifactId: 'art-002',
        content: 'new content',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.artifactId).toBe('art-002')
      }
    })

    test('fails on missing artifact_id', () => {
      const result = parseArtifactEditInput({ title: 'No ID' })
      expect(result.ok).toBe(false)
    })
  })
})
