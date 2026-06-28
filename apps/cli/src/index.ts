#!/usr/bin/env bun
/**
 * proma — Proma 命令行工具入口。
 *
 * 用法：
 *   proma <command> [subcommand] [args] [--flags]
 *   proma session list|info|outline|search|export ...
 *
 * 全局 flag：
 *   --json            输出机器可读 JSON
 *   --config-dir DIR  指定 Proma 配置目录（默认 ~/.proma，PROMA_DEV=1 → ~/.proma-dev）
 *   --dev             使用 ~/.proma-dev
 *
 * 设计：命令注册表驱动（registry.ts）。`session` 是一个命名空间，
 * 其下的 list/info/outline/search/export 各自在 commands/ 注册。扩面只加文件。
 */
import { parseArgs, boolFlag, strFlag } from './args'
import { getCommand, allCommands } from './registry'
import { EXIT_OK, EXIT_USAGE, EXIT_ERROR, UsageError, errorLine, info, emitText } from './output'
import type { PathOptions } from './paths'

// 注册命令（import 即注册）
import './commands/list'
import './commands/info'
import './commands/outline'
import './commands/search'
import './commands/export'

function printHelp(): void {
  info('proma — Proma 会话渐进式读取 CLI\n')
  info('用法: proma session <command> [args] [--flags]\n')
  info('命令:')
  for (const c of allCommands()) {
    info(`  ${c.usage.padEnd(64)} ${c.summary}`)
  }
  info('\n全局 flag: --json  --config-dir DIR  --dev')
  info('\n渐进式读取建议: 先 info/outline 看结构 → search 定位 → export --turns 取片段')
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    printHelp()
    return EXIT_OK
  }

  // 命名空间：当前只有 session，支持 `proma session <cmd>` 与直接 `proma <cmd>`
  let rest = argv
  if (argv[0] === 'session') rest = argv.slice(1)

  const cmdName = rest[0]
  if (!cmdName) {
    printHelp()
    return EXIT_USAGE
  }

  const command = getCommand(cmdName)
  if (!command) {
    errorLine(`未知命令: ${cmdName}`)
    printHelp()
    return EXIT_USAGE
  }

  const parsed = parseArgs(rest.slice(1))
  const pathOpts: PathOptions = {
    configDir: strFlag(parsed.flags, 'config-dir'),
    dev: boolFlag(parsed.flags, 'dev'),
  }
  const json = boolFlag(parsed.flags, 'json')

  try {
    return await command.run({ args: parsed, pathOpts, json })
  } catch (err) {
    if (err instanceof UsageError) {
      errorLine(err.message)
      info(`用法: proma ${command.usage}`)
      return EXIT_USAGE
    }
    errorLine(err instanceof Error ? err.message : String(err))
    return EXIT_ERROR
  }
}

main().then((code) => process.exit(code))
