/**
 * Proma Git / PR 推广标识
 *
 * 目标：当 Agent 代用户创建 commit / PR 时，附带可搜索、可关闭的 Proma 标识，
 * 用于产品曝光；同时避免 Co-Authored-By 假冒作者、污染 GitHub contributors。
 *
 * System prompt 指令 — 引导 Agent 在 git commit / gh pr 时附加标识。
 *
 * 后续可增强：canUseTool 对 Bash 的确定性 --trailer / body 注入。
 */

/** 默认开启：对齐 Claude Code / Cursor「默认归因 + 可关」策略 */
export const DEFAULT_GIT_ATTRIBUTION_ENABLED = true

/** 官方站点（商业版 / 产品主页） */
export const PROMA_OFFICIAL_URL = 'https://proma.cool'

/** 开源仓库完整地址 */
export const PROMA_GITHUB_URL = 'https://github.com/proma-ai/Proma'

/** Commit trailer（标准 git trailer，不进入 GitHub co-author 列表） */
export const PROMA_COMMIT_TRAILER = 'Made-with: Proma'

/**
 * PR / MR 描述底部标识。
 * 含官方站 + 开源仓库完整链接，便于推广与引流。
 */
export const PROMA_PR_ATTRIBUTION =
  `Made with [Proma](${PROMA_OFFICIAL_URL}) · [GitHub](${PROMA_GITHUB_URL})`

export interface GitAttributionConfig {
  /** 是否启用；undefined 视为默认开启 */
  enabled?: boolean
}

/** 解析最终是否启用（缺省 = 默认开启） */
export function isGitAttributionEnabled(config?: GitAttributionConfig | boolean | null): boolean {
  if (typeof config === 'boolean') return config
  if (config && typeof config === 'object' && typeof config.enabled === 'boolean') {
    return config.enabled
  }
  return DEFAULT_GIT_ATTRIBUTION_ENABLED
}

/** 注入到 buildSystemPrompt 的 Git/PR 标识规范 */
export function buildGitAttributionPromptSection(enabled: boolean): string {
  if (!enabled) {
    return `## Git / PR 标识
用户已关闭 Proma 标识；除非当次明确要求，不要添加任何 Proma 归因。`
  }

  return `## Git / PR 标识
当你代用户创建 commit 或 PR/MR 时，除非用户当次明确拒绝：
- commit 的 message 末尾追加唯一的 \`${PROMA_COMMIT_TRAILER}\` trailer；不要使用 \`Co-Authored-By\`，不要改 author/committer。
- PR/MR 描述末尾追加唯一的 \`${PROMA_PR_ATTRIBUTION}\`。`
}
