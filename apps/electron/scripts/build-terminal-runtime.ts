#!/usr/bin/env bun
/**
 * Terminal Runtime（Electron utility process）构建脚本。
 *
 * 与商业版的 main/agent runtime 使用相同 PROMA_API_URL define 和 localhost
 * 打包守卫。Terminal runtime 当前不直接读取 API 地址，保留该策略以防未来
 * 依赖图接入 Cloud 配置后退回默认端点。
 */
import * as esbuild from 'esbuild'

const isWatch = process.argv.includes('--watch')
const PROMA_API_URL = process.env.PROMA_API_URL || 'https://api.proma.cool/api/v1'

console.log(`[build:terminal-runtime] PROMA_API_URL = ${PROMA_API_URL}`)
if (PROMA_API_URL.includes('localhost') && !process.env.ALLOW_LOCALHOST) {
  console.error('[build:terminal-runtime] 错误：不允许使用 localhost 地址构建分发包！')
  console.error('[build:terminal-runtime] 请在 .env 中设置正确的 PROMA_API_URL')
  console.error('[build:terminal-runtime] 如确需本地调试，请设置环境变量 ALLOW_LOCALHOST=1')
  process.exit(1)
}

const buildOptions: esbuild.BuildOptions = {
  entryPoints: ['src/utility/terminal-runtime.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/terminal-runtime.cjs',
  external: ['electron', 'node-pty'],
  define: { 'process.env.PROMA_API_URL': JSON.stringify(PROMA_API_URL) },
}

if (isWatch) {
  const ctx = await esbuild.context(buildOptions)
  await ctx.watch()
  console.log('[build:terminal-runtime] 监听文件变化中...')
} else {
  await esbuild.build(buildOptions)
}
