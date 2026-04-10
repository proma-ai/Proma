/**
 * 工具参数校验模块
 *
 * 在 canUseTool 回调中拦截参数缺失的工具调用，
 * 返回描述性 deny message 引导模型重试。
 */

/** 已知工具的必需参数映射 */
export const TOOL_REQUIRED_PARAMS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  ['Write', ['file_path', 'content']],
  ['Edit', ['file_path', 'old_string', 'new_string']],
  ['Bash', ['command']],
  ['Read', ['file_path']],
  ['Glob', ['pattern']],
  ['Grep', ['pattern']],
  ['Agent', ['prompt', 'description']],
])

/** 校验失败结果，与 PermissionResult deny 形状一致 */
export interface ToolValidationFailure {
  behavior: 'deny'
  message: string
}

/**
 * 校验工具调用的必需参数是否存在且非空。
 *
 * 未知工具或参数完整时返回 null；
 * 参数缺失时返回 deny 结果，message 中列出缺失的参数名。
 */
export function validateToolInput(
  toolName: string,
  input: Record<string, unknown>,
): ToolValidationFailure | null {
  const requiredParams = TOOL_REQUIRED_PARAMS.get(toolName)
  if (!requiredParams) return null

  const missing: string[] = []
  for (const param of requiredParams) {
    const value = input[param]
    if (value === undefined || value === null || value === '') {
      missing.push(param)
    }
  }

  if (missing.length === 0) return null

  const paramList = missing.map((p) => `"${p}"`).join(', ')
  const message = missing.length === 1
    ? `Tool "${toolName}" is missing required parameter ${paramList}. Please retry with all required parameters filled in.`
    : `Tool "${toolName}" is missing required parameters: ${paramList}. Please retry with all required parameters filled in.`

  return { behavior: 'deny' as const, message }
}
