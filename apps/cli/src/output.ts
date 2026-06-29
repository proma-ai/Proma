/**
 * 统一输出与退出码约定。
 *
 * 设计目标：CLI 主要消费者是「上下文有限的 Agent」。因此：
 *   - 机器可读结果走 stdout（--json 时为单个 JSON）
 *   - 人读日志 / 进度 / 错误走 stderr，绝不污染 stdout 的数据
 *   - 退出码：0 成功，1 运行期错误（找不到会话等），2 用法错误（参数非法）
 */

export const EXIT_OK = 0
export const EXIT_ERROR = 1
export const EXIT_USAGE = 2

/** 写一行人读信息到 stderr。 */
export function info(msg: string): void {
  process.stderr.write(msg + '\n')
}

/** 写错误到 stderr（带 error: 前缀）。 */
export function errorLine(msg: string): void {
  process.stderr.write(`error: ${msg}\n`)
}

/** 输出机器可读 JSON 到 stdout。 */
export function emitJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n')
}

/** 输出纯文本到 stdout（不加额外换行外的内容）。 */
export function emitText(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : text + '\n')
}

/** 命令处理函数约定的返回：退出码。 */
export type CommandExit = number

/** 抛出此错误表示用法错误（参数非法），主入口据此返回 EXIT_USAGE。 */
export class UsageError extends Error {}
