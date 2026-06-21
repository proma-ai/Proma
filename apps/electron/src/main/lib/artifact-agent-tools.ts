interface ArtifactToolContext {
  sessionId: string
  workspaceId?: string
  runId?: string
}

interface ArtifactToolResult extends Record<string, unknown> {
  content: Array<{ type: 'text'; text: string }>
}

type ZodNamespace = typeof import('zod')['z']

export const ARTIFACT_SERVER_NAME = 'artifact'
export const ARTIFACT_CREATE_TOOL = 'create_artifact'
export const ARTIFACT_EDIT_TOOL = 'edit_artifact'
export const ARTIFACT_LOAD_GUIDELINES_TOOL = 'load_artifact_guidelines'
export const MAX_ARTIFACT_CONTENT_CHARS = 120_000

export function isArtifactsEnabled(config: { enabled?: boolean } | undefined): boolean {
  return config?.enabled === true
}

const ARTIFACT_MCP_TOOL_PREFIX = 'artifact'

export function getArtifactAllowedToolNames(enabled: boolean): string[] {
  if (!enabled) return []
  return [
    `mcp__${ARTIFACT_MCP_TOOL_PREFIX}__${ARTIFACT_LOAD_GUIDELINES_TOOL}`,
    `mcp__${ARTIFACT_MCP_TOOL_PREFIX}__${ARTIFACT_CREATE_TOOL}`,
    `mcp__${ARTIFACT_MCP_TOOL_PREFIX}__${ARTIFACT_EDIT_TOOL}`,
    ARTIFACT_LOAD_GUIDELINES_TOOL,
    ARTIFACT_CREATE_TOOL,
    ARTIFACT_EDIT_TOOL,
  ]
}

export function isArtifactToolName(toolName: string): boolean {
  return (
    toolName === ARTIFACT_CREATE_TOOL ||
    toolName === ARTIFACT_EDIT_TOOL ||
    toolName.endsWith(`__${ARTIFACT_CREATE_TOOL}`) ||
    toolName.endsWith(`__${ARTIFACT_EDIT_TOOL}`)
  )
}

export function isArtifactGuidelineToolName(toolName: string): boolean {
  return toolName === ARTIFACT_LOAD_GUIDELINES_TOOL || toolName.endsWith(`__${ARTIFACT_LOAD_GUIDELINES_TOOL}`)
}

function jsonResult(payload: Record<string, unknown>): ArtifactToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  }
}

function buildSchemas(z: ZodNamespace) {
  return {
    loadGuidelines: {
      focus: z.enum(['general', 'chart', 'diagram', 'interactive', 'dashboard']).optional()
        .describe('Optional guideline focus for the artifact you are about to build.'),
    },
    createArtifact: {
      title: z.string().min(1).max(120).describe('Short human-readable artifact title.'),
      type: z.enum(['code', 'html', 'svg', 'mermaid', 'markdown'])
        .describe('Artifact content type: code (source code), html (interactive widget), svg (vector graphic), mermaid (diagram), markdown (document).'),
      content: z.string().min(1).max(MAX_ARTIFACT_CONTENT_CHARS)
        .describe('Artifact content. For html type: HTML/SVG/CSS/JS fragment (no doctype/html/head/body). For code type: source code. For markdown: markdown text.'),
      language: z.string().max(40).optional()
        .describe('Programming language identifier for code type artifacts (e.g. typescript, python, go).'),
      description: z.string().max(500).optional()
        .describe('One short sentence describing what the artifact shows.'),
    },
    editArtifact: {
      artifact_id: z.string().min(1).describe('ID of the artifact to edit.'),
      title: z.string().min(1).max(120).optional()
        .describe('Updated artifact title.'),
      content: z.string().min(1).max(MAX_ARTIFACT_CONTENT_CHARS).optional()
        .describe('Updated artifact content (full replacement, not diff).'),
      language: z.string().max(40).optional()
        .describe('Updated programming language for code type artifacts.'),
    },
  }
}

export function buildArtifactRunPrompt(): string {
  return [
    '## Artifact authorization for this run',
    '',
    'The user has enabled Artifacts for this run. You may use `create_artifact` and `edit_artifact` tools to create and iterate on persistent, named content pieces that appear in a dedicated side panel.',
    '',
    'Rules:',
    '- Before your first artifact in this run, call `load_artifact_guidelines` with the closest focus.',
    '- Use `create_artifact` to produce a new named artifact. Use `edit_artifact` to update an existing one.',
    '- For html type: do not include doctype, html, head, body, iframe, object, embed, form, or base tags.',
    '- html type artifacts run in a sandboxed iframe. Do not use inline event handlers such as onclick/onerror.',
    '- Do not fetch live data from inside an artifact. Use data already present in the conversation.',
    '- Default visual style: light surfaces, warm neutral cards, flat solid fills, 8-12px radii, restrained accents.',
    '- For charts and dashboards, data marks must be visibly encoded with contrasting fills, borders, labels, and legends.',
    '- Prefer responsive SVG/CSS/vanilla JS. Keep text legible, dimensions stable.',
  ].join('\n')
}

export function getArtifactGuidelines(focus: string = 'general'): string {
  const common = [
    'Build polished, self-contained content for the artifact side panel.',
    'For html artifacts: use inline CSS scoped to one root element. Do not style html or body.',
    'Use app-friendly CSS variables: --background, --foreground, --muted, --muted-foreground, --border, --primary, --card.',
    'Default aesthetic: flat, native, calm, readable. Prefer light/transparent outer surfaces with warm neutral cards.',
    'Do not paint with pure black (#000, #050505) unless the user explicitly requests a dark theme.',
    'For streaming safety, place scripts at the end of html artifacts.',
    'Never use iframe/object/embed/form/base/meta/link. Never use javascript:, data:, vbscript:, or file: URLs.',
  ]

  const focused: Record<string, string[]> = {
    chart: [
      'For charts, provide labeled axes, units, legends, and useful empty states.',
      'Prefer SVG or lightweight canvas.',
      'Every data mark must be visible before interaction.',
    ],
    diagram: [
      'For diagrams, prioritize readable hierarchy, alignment, connectors, labels.',
      'Use SVG viewBox with width="100%" and avoid tiny labels.',
    ],
    interactive: [
      'For interactive artifacts, keep state local to the iframe.',
      'Controls should have immediate visual feedback and sane defaults.',
    ],
    dashboard: [
      'For dashboards, lead with the most important state, use dense but readable cards.',
      'Avoid decorative hero layouts.',
    ],
    general: [],
  }

  return [...common, ...(focused[focus] ?? [])].join('\n')
}

export async function injectArtifactMcpServer(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  mcpServers: Record<string, Record<string, unknown>>,
  ctx: ArtifactToolContext,
): Promise<void> {
  const { z } = await import('zod')
  const schemas = buildSchemas(z)

  const server = sdk.createSdkMcpServer({
    name: ARTIFACT_SERVER_NAME,
    version: '1.0.0',
    tools: [
      sdk.tool(
        ARTIFACT_LOAD_GUIDELINES_TOOL,
        'Load concise Artifact design and safety guidelines before creating an artifact.',
        schemas.loadGuidelines,
        async (args) => jsonResult({
          type: 'artifact_guidelines',
          focus: args.focus ?? 'general',
          guidelines: getArtifactGuidelines(args.focus ?? 'general'),
        }),
        { annotations: { readOnlyHint: true } },
      ),
      sdk.tool(
        ARTIFACT_CREATE_TOOL,
        'Create a new named artifact that appears in the side panel. Use for code, HTML widgets, SVG graphics, Mermaid diagrams, or Markdown documents.',
        schemas.createArtifact,
        async (args) => {
          const artifactId = `art-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          return jsonResult({
            type: 'artifact_created',
            ok: true,
            artifact: {
              id: artifactId,
              title: args.title,
              type: args.type,
              language: args.language,
              content: args.content,
              description: args.description,
              version: 1,
              sessionId: ctx.sessionId,
              workspaceId: ctx.workspaceId,
              runId: ctx.runId,
              contentLength: args.content.length,
            },
          })
        },
      ),
      sdk.tool(
        ARTIFACT_EDIT_TOOL,
        'Edit an existing artifact by ID. Updates title, content, and/or language. The new content replaces the old content entirely.',
        schemas.editArtifact,
        async (args) => jsonResult({
          type: 'artifact_edited',
          ok: true,
          artifact_id: args.artifact_id,
          updates: {
            ...(args.title !== undefined && { title: args.title }),
            ...(args.content !== undefined && { content: args.content }),
            ...(args.language !== undefined && { language: args.language }),
          },
        }),
      ),
    ],
  })

  mcpServers[ARTIFACT_SERVER_NAME] = server as unknown as Record<string, unknown>
}
