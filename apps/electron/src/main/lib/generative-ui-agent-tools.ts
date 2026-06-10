interface GenerativeUiToolContext {
  sessionId: string
  workspaceId?: string
  runId?: string
}

interface GenerativeUiToolResult extends Record<string, unknown> {
  content: Array<{ type: 'text'; text: string }>
}

type ZodNamespace = typeof import('zod')['z']

export const GENERATIVE_UI_SERVER_NAME = 'generative-ui'
export const GENERATIVE_UI_SHOW_WIDGET_TOOL = 'show_widget'
export const GENERATIVE_UI_LOAD_GUIDELINES_TOOL = 'load_widget_guidelines'
export const MAX_GENERATIVE_WIDGET_CODE_CHARS = 120_000

export function isGenerativeUiRunEnabled(config: { enabled?: boolean } | undefined): boolean {
  return config?.enabled === true
}

export function getGenerativeUiAllowedToolNames(enabled: boolean): string[] {
  if (!enabled) return []
  return [
    `mcp__${GENERATIVE_UI_MCP_TOOL_PREFIX}__${GENERATIVE_UI_LOAD_GUIDELINES_TOOL}`,
    `mcp__${GENERATIVE_UI_MCP_TOOL_PREFIX}__${GENERATIVE_UI_SHOW_WIDGET_TOOL}`,
    GENERATIVE_UI_LOAD_GUIDELINES_TOOL,
    GENERATIVE_UI_SHOW_WIDGET_TOOL,
  ]
}

const GENERATIVE_UI_MCP_TOOL_PREFIX = GENERATIVE_UI_SERVER_NAME

export function isGenerativeUiToolName(toolName: string): boolean {
  return toolName === GENERATIVE_UI_SHOW_WIDGET_TOOL || toolName.endsWith(`__${GENERATIVE_UI_SHOW_WIDGET_TOOL}`)
}

export function isGenerativeUiGuidelineToolName(toolName: string): boolean {
  return toolName === GENERATIVE_UI_LOAD_GUIDELINES_TOOL || toolName.endsWith(`__${GENERATIVE_UI_LOAD_GUIDELINES_TOOL}`)
}

function jsonResult(payload: Record<string, unknown>): GenerativeUiToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  }
}

function buildSchemas(z: ZodNamespace) {
  return {
    loadGuidelines: {
      focus: z.enum(['general', 'chart', 'diagram', 'interactive', 'dashboard']).optional()
        .describe('Optional guideline focus for the widget you are about to build.'),
    },
    showWidget: {
      title: z.string().min(1).max(120).describe('Short human-readable widget title.'),
      widget_code: z.string().min(1).max(MAX_GENERATIVE_WIDGET_CODE_CHARS)
        .describe('HTML/SVG/CSS/JS fragment to render in the sandbox iframe. Do not include doctype/html/head/body.'),
      description: z.string().max(500).optional().describe('One short sentence describing what the widget shows.'),
      interaction_mode: z.enum(['render-only', 'interactive']).optional()
        .describe('Use interactive when the widget includes local JS controls or animations.'),
      layout: z.enum(['compact', 'wide', 'full']).optional()
        .describe('Use compact for small controls/cards, wide for most charts/dashboards, and full only when the widget intentionally needs the whole message width.'),
      preferred_width: z.number().int().min(240).max(1600).optional()
        .describe('Optional preferred rendered width in pixels. Use with layout compact or wide when the widget has a natural maximum width.'),
      initial_height: z.number().int().min(120).max(2000).optional()
        .describe('Optional initial iframe height in pixels before the widget reports its measured height.'),
      pin_target: z.enum(['report', 'dashboard']).optional()
        .describe('Optional future persistence target. Use only if the user explicitly asks to pin or publish it.'),
    },
  }
}

export function buildGenerativeUiRunPrompt(): string {
  return [
    '## Generative UI authorization for this run',
    '',
    'The user explicitly enabled Generative UI for this run only. You may use the `show_widget` tool when an inline visual or interactive surface is materially better than text.',
    '',
    'Rules:',
    '- Before your first widget in this run, call `load_widget_guidelines` with the closest focus.',
    '- Do not emit raw HTML in normal Markdown. Widget HTML must go through `show_widget.widget_code`.',
    '- `widget_code` must be a fragment only: no doctype, html, head, body, iframe, object, embed, form, or base tags.',
    '- For small cards or controls, set `layout: "compact"` and `preferred_width` to the natural card width. Use `layout: "wide"` for dashboards/charts and `layout: "full"` only when the surface intentionally spans the full message width.',
    '- Generated JavaScript runs only inside a sandbox iframe at final render time. Streaming preview is visual-only.',
    '- Do not use inline event handlers such as onclick/onerror; bind events from a script block instead.',
    '- Do not fetch live data from inside the widget. Use data already present in the conversation or files/tools you are allowed to read.',
    '- Default to a Claude-like native visual style: light or transparent outer surfaces, warm neutral cards, flat solid fills, 8-12px radii, and restrained accent colors. Do not use a large pure-black or near-black canvas unless the user explicitly requests a dark theme.',
    '- For charts, treemaps, diagrams, and dashboards, the data marks themselves must be visibly encoded with contrasting fills, borders, labels, and a small legend or key when color has meaning.',
    '- Prefer responsive SVG/CSS/vanilla JS. Keep text legible, dimensions stable, and UI useful without explaining the feature in prose.',
    '- Use `interaction_mode: "interactive"` only for local controls, animation, hover, canvas, or chart interactions. Otherwise use `render-only`.',
  ].join('\n')
}

export function getGenerativeUiGuidelines(focus: string = 'general'): string {
  const common = [
    'Build a polished, self-contained HTML/SVG fragment for a sandbox iframe.',
    'Use inline CSS scoped to one root element such as `.generative-widget-root`. Do not style `html` or `body`; put backgrounds, padding, and max-widths on the widget root/card.',
    'Use stable layout constraints on the root element: width:100%, explicit aspect ratios or min heights, and no position:fixed.',
    'Choose layout intent deliberately: compact for small cards/controls, wide for charts/dashboards, full only for intentionally full-bleed surfaces.',
    'Use app-friendly CSS variables when helpful: --background, --foreground, --muted, --muted-foreground, --border, --primary, --card.',
    'You may also use Claude-like aliases provided by the iframe: --color-background-primary, --color-background-secondary, --color-background-tertiary, --color-text-primary, --color-text-secondary, --color-border-tertiary, --font-sans, --border-radius-md, --border-radius-lg.',
    'Default aesthetic: flat, native, calm, and readable. Prefer light/transparent outer surfaces with warm neutral cards and 2-3 meaningful accent ramps; avoid neon, glow, heavy shadows, and one-note dark panels.',
    'Do not paint the whole widget with pure black or near-black colors such as #000, #050505, #08080c, #0b0b10, or #0f0f13 unless the user explicitly asks for a dark theme. If dark mode is needed, keep visible contrast in every card, chart mark, border, and label.',
    'For colored chips, cards, and chart marks, text must use a high-contrast color from the same color family or a clearly readable foreground. Never place gray text on low-contrast dark fills.',
    'For streaming safety, place scripts at the end and make the visual shell useful before scripts execute.',
    'Do not use inline event handlers such as onclick/onerror; attach listeners from script after the DOM exists.',
    'Never use iframe/object/embed/form/base/meta/link. Never use javascript:, data:, vbscript:, or file: URLs.',
  ]

  const focused: Record<string, string[]> = {
    chart: [
      'For charts, provide labeled axes, units, legends, and useful empty states.',
      'Prefer SVG or lightweight canvas. CDN chart libraries are allowed only from the sandbox whitelist when truly needed.',
      'Every data mark must be visible before interaction: use non-transparent fills, clear gutters/borders, readable labels, and a legend when color encodes group or category.',
      'For treemaps, each rectangle must be visibly filled and separated; size encodes value, color encodes group or category, labels appear only where they fit, and small tiles should remain discoverable through hover/details rather than invisible text.',
      'Do not render chart labels floating over an empty-looking dark field. If a treemap or chart area looks like a flat black slab, redesign the color encoding before calling show_widget.',
    ],
    diagram: [
      'For diagrams, prioritize readable hierarchy, alignment, connectors, labels, and mobile-safe scaling.',
      'Use SVG viewBox with width="100%" and avoid tiny labels.',
    ],
    interactive: [
      'For interactive widgets, keep state local to the iframe and initialize controls after DOMContentLoaded or at script execution.',
      'Controls should have immediate visual feedback and sane default values.',
    ],
    dashboard: [
      'For dashboards, lead with the most important state, use dense but readable cards, and make comparisons scannable.',
      'Avoid decorative hero layouts; operational dashboards should stay compact and task-focused.',
    ],
    general: [],
  }

  return [...common, ...(focused[focus] ?? [])].join('\n')
}

export async function injectGenerativeUiMcpServer(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  mcpServers: Record<string, Record<string, unknown>>,
  ctx: GenerativeUiToolContext,
): Promise<void> {
  const { z } = await import('zod')
  const schemas = buildSchemas(z)

  const server = sdk.createSdkMcpServer({
    name: GENERATIVE_UI_SERVER_NAME,
    version: '1.0.0',
    tools: [
      sdk.tool(
        GENERATIVE_UI_LOAD_GUIDELINES_TOOL,
        'Load concise Generative UI design and safety guidelines before creating a sandboxed widget.',
        schemas.loadGuidelines,
        async (args) => jsonResult({
          type: 'generative_ui_guidelines',
          focus: args.focus ?? 'general',
          guidelines: getGenerativeUiGuidelines(args.focus ?? 'general'),
        }),
        { annotations: { readOnlyHint: true } },
      ),
      sdk.tool(
        GENERATIVE_UI_SHOW_WIDGET_TOOL,
        'Render an inline sandboxed Generative UI widget in the conversation. Use only after this run has explicit user authorization.',
        schemas.showWidget,
        async (args) => jsonResult({
          type: 'generative_ui_widget',
          ok: true,
          artifact: {
            title: args.title,
            description: args.description,
            interactionMode: args.interaction_mode ?? 'interactive',
            layout: args.layout,
            preferredWidth: args.preferred_width,
            initialHeight: args.initial_height,
            pinTarget: args.pin_target,
            owner: {
              sessionId: ctx.sessionId,
              workspaceId: ctx.workspaceId,
              runId: ctx.runId,
            },
            widgetCodeLength: args.widget_code.length,
          },
        }),
      ),
    ],
  })

  mcpServers[GENERATIVE_UI_SERVER_NAME] = server as unknown as Record<string, unknown>
  console.log('[Agent 编排] 已注入本轮生成式 UI 工具 (generative-ui)')
}
