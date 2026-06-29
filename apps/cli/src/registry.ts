/**
 * 命令注册表。新增命令 = 在 commands/ 下加一个文件并 register() —— 扩面只加文件，不动主入口。
 */
import type { ParsedArgs } from './args'
import type { PathOptions } from './paths'
import { type CommandExit, UsageError } from './output'

export interface CommandContext {
  args: ParsedArgs
  /** 从全局 flag 解析出的路径选项（--config-dir / --dev / PROMA_DEV）。 */
  pathOpts: PathOptions
  /** 是否输出机器可读 JSON（--json）。 */
  json: boolean
}

export interface Command {
  name: string
  summary: string
  /** 一行用法示例（不含 "proma " 前缀）。 */
  usage: string
  run: (ctx: CommandContext) => Promise<CommandExit> | CommandExit
}

const registry = new Map<string, Command>()

export function register(cmd: Command): void {
  registry.set(cmd.name, cmd)
}

export function getCommand(name: string): Command | undefined {
  return registry.get(name)
}

export function allCommands(): Command[] {
  return [...registry.values()]
}

export { UsageError }
