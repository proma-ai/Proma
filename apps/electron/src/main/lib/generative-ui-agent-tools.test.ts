import { describe, expect, test } from 'bun:test'
import {
  GENERATIVE_UI_LOAD_GUIDELINES_TOOL,
  GENERATIVE_UI_SHOW_WIDGET_TOOL,
  buildGenerativeUiRunPrompt,
  getGenerativeUiGuidelines,
  getGenerativeUiAllowedToolNames,
  isGenerativeUiGuidelineToolName,
  isGenerativeUiRunEnabled,
  isGenerativeUiToolName,
} from './generative-ui-agent-tools'

describe('Generative UI agent tools', () => {
  test('run prompt makes widget usage explicit and run-scoped', () => {
    const prompt = buildGenerativeUiRunPrompt()

    expect(prompt).toContain(GENERATIVE_UI_SHOW_WIDGET_TOOL)
    expect(prompt).toContain(GENERATIVE_UI_LOAD_GUIDELINES_TOOL)
    expect(prompt).toContain('this run only')
    expect(prompt).toContain('sandbox iframe')
    expect(prompt).toContain('Do not emit raw HTML')
    expect(prompt).toContain('layout: "compact"')
    expect(prompt).toContain('Do not use inline event handlers')
    expect(prompt).toContain('Claude-like native visual style')
    expect(prompt).toContain('pure-black or near-black')
    expect(prompt).toContain('treemaps')
  })

  test('guidelines include renderer and security constraints', () => {
    const guidelines = getGenerativeUiGuidelines('interactive')

    expect(guidelines).toContain('self-contained HTML/SVG fragment')
    expect(guidelines).toContain('Do not style `html` or `body`')
    expect(guidelines).toContain('Choose layout intent deliberately')
    expect(guidelines).toContain('scripts at the end')
    expect(guidelines).toContain('Do not use inline event handlers')
    expect(guidelines).toContain('Never use iframe')
    expect(guidelines).toContain('Controls should have immediate visual feedback')
    expect(guidelines).toContain('--color-background-primary')
    expect(guidelines).toContain('near-black colors')
    expect(guidelines).toContain('low-contrast dark fills')
  })

  test('chart guidelines require readable visible treemap marks', () => {
    const guidelines = getGenerativeUiGuidelines('chart')

    expect(guidelines).toContain('Every data mark must be visible')
    expect(guidelines).toContain('For treemaps')
    expect(guidelines).toContain('visibly filled and separated')
    expect(guidelines).toContain('flat black slab')
  })

  test('tool name helpers match plain and MCP-prefixed names', () => {
    expect(isGenerativeUiToolName('show_widget')).toBe(true)
    expect(isGenerativeUiToolName('mcp__generative-ui__show_widget')).toBe(true)
    expect(isGenerativeUiGuidelineToolName('load_widget_guidelines')).toBe(true)
    expect(isGenerativeUiGuidelineToolName('mcp__generative-ui__load_widget_guidelines')).toBe(true)
    expect(isGenerativeUiToolName('load_widget_guidelines')).toBe(false)
  })

  test('run gating exposes no tools when disabled and show_widget tools when enabled', () => {
    expect(isGenerativeUiRunEnabled(undefined)).toBe(false)
    expect(isGenerativeUiRunEnabled({ enabled: false })).toBe(false)
    expect(isGenerativeUiRunEnabled({ enabled: true })).toBe(true)

    expect(getGenerativeUiAllowedToolNames(false)).toEqual([])
    expect(getGenerativeUiAllowedToolNames(true)).toEqual([
      'mcp__generative-ui__load_widget_guidelines',
      'mcp__generative-ui__show_widget',
      'load_widget_guidelines',
      'show_widget',
    ])
  })
})
