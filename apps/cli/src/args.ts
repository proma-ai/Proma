/**
 * 极简参数解析（零依赖）。
 *
 * 不引入 yargs/commander，避免给打包产物增加体积与解析歧义。约定：
 *   - --flag            → boolean true
 *   - --key value       → string
 *   - --key=value       → string
 *   - 其余非 -- 开头的   → positionals（按顺序）
 *
 * 数值/区间等语义由各命令自行从字符串解析（见 parseRange 等）。
 */
export interface ParsedArgs {
  positionals: string[]
  flags: Record<string, string | boolean>
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      const body = arg.slice(2)
      const eq = body.indexOf('=')
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1)
      } else {
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('--')) {
          flags[body] = next
          i++
        } else {
          flags[body] = true
        }
      }
    } else {
      positionals.push(arg)
    }
  }

  return { positionals, flags }
}

/** 取字符串 flag；不存在或为 boolean 返回 undefined。 */
export function strFlag(flags: Record<string, string | boolean>, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = flags[n]
    if (typeof v === 'string') return v
  }
  return undefined
}

/** 取 boolean flag（存在即真）。 */
export function boolFlag(flags: Record<string, string | boolean>, ...names: string[]): boolean {
  return names.some((n) => flags[n] === true || flags[n] === 'true')
}

/** 取数值 flag；解析失败返回 undefined。 */
export function numFlag(flags: Record<string, string | boolean>, ...names: string[]): number | undefined {
  const s = strFlag(flags, ...names)
  if (s === undefined) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/** 解析 "A-B" 形式的闭区间；单个数字 "N" 视为 [N, N]。失败返回 undefined。 */
export function parseRange(s: string | undefined): [number, number] | undefined {
  if (!s) return undefined
  const m = /^(\d+)-(\d+)$/.exec(s)
  if (m) return [Number(m[1]), Number(m[2])]
  if (/^\d+$/.test(s)) return [Number(s), Number(s)]
  return undefined
}
