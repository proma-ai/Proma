import { describe, test, expect } from 'bun:test'
import {
  ARTIFACT_SERVER_NAME,
  ARTIFACT_CREATE_TOOL,
  ARTIFACT_EDIT_TOOL,
  isArtifactToolName,
  isArtifactGuidelineToolName,
  isArtifactsEnabled,
  getArtifactAllowedToolNames,
} from './artifact-agent-tools'

describe('artifact-agent-tools', () => {
  describe('isArtifactsEnabled', () => {
    test('returns true when enabled', () => {
      expect(isArtifactsEnabled({ enabled: true })).toBe(true)
    })

    test('returns false when disabled', () => {
      expect(isArtifactsEnabled({ enabled: false })).toBe(false)
    })

    test('returns false when undefined', () => {
      expect(isArtifactsEnabled(undefined)).toBe(false)
    })
  })

  describe('getArtifactAllowedToolNames', () => {
    test('returns tool names when enabled', () => {
      const names = getArtifactAllowedToolNames(true)
      expect(names).toContain(ARTIFACT_CREATE_TOOL)
      expect(names).toContain(ARTIFACT_EDIT_TOOL)
      expect(names).toContain('load_artifact_guidelines')
    })

    test('includes MCP-qualified names', () => {
      const names = getArtifactAllowedToolNames(true)
      expect(names).toContain(`mcp__${ARTIFACT_SERVER_NAME}__${ARTIFACT_CREATE_TOOL}`)
      expect(names).toContain(`mcp__${ARTIFACT_SERVER_NAME}__${ARTIFACT_EDIT_TOOL}`)
    })

    test('returns empty when disabled', () => {
      expect(getArtifactAllowedToolNames(false)).toEqual([])
    })
  })

  describe('isArtifactToolName', () => {
    test('recognizes create_artifact', () => {
      expect(isArtifactToolName(ARTIFACT_CREATE_TOOL)).toBe(true)
    })

    test('recognizes edit_artifact', () => {
      expect(isArtifactToolName(ARTIFACT_EDIT_TOOL)).toBe(true)
    })

    test('recognizes MCP-qualified create_artifact', () => {
      expect(isArtifactToolName(`mcp__artifact__${ARTIFACT_CREATE_TOOL}`)).toBe(true)
    })

    test('recognizes MCP-qualified edit_artifact', () => {
      expect(isArtifactToolName(`mcp__artifact__${ARTIFACT_EDIT_TOOL}`)).toBe(true)
    })

    test('rejects unrelated tool names', () => {
      expect(isArtifactToolName('read')).toBe(false)
      expect(isArtifactToolName('write')).toBe(false)
    })
  })

  describe('isArtifactGuidelineToolName', () => {
    test('recognizes load_artifact_guidelines', () => {
      expect(isArtifactGuidelineToolName('load_artifact_guidelines')).toBe(true)
    })

    test('recognizes MCP-qualified name', () => {
      expect(isArtifactGuidelineToolName('mcp__artifact__load_artifact_guidelines')).toBe(true)
    })
  })
})
