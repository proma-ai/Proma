#!/usr/bin/env bun
/**
 * Agent Runtime（Electron utility process）构建脚本
 *
 * 上游把 Pi runtime 隔离到独立的 utility process（src/utility/agent-runtime.ts），
 * 该 bundle 会一起打包 PiAgentAdapter 及其依赖的商业版代码。
 *
 * 当前 utility 侧的请求地址一律由主进程通过 IPC 以 PiAgentQueryOptions.baseUrl 传入，
 * 该 bundle 里并没有 process.env.PROMA_API_URL 的读取点，所以下面的 define 目前是 no-op。
 * 保留它是前向防御：一旦将来 @proma/cloud（getCloudApiConfig 读该变量）进入 utility 依赖图，
 * 打包产物不会静默退回默认 API 地址。localhost 守卫同理与 build-main.ts 保持一致。
 *
 * 使用：
 *   bun run scripts/build-agent-runtime.ts           # 构建
 *   bun run scripts/build-agent-runtime.ts --watch   # 监听模式
 */

import * as esbuild from 'esbuild'

const isWatch = process.argv.includes('--watch')

// 从环境变量读取 API 地址（Bun 自动加载 .env）
const PROMA_API_URL = process.env.PROMA_API_URL || 'https://api.proma.cool/api/v1'

console.log(`[build:agent-runtime] PROMA_API_URL = ${PROMA_API_URL}`)

// 安全检查：防止误用 localhost 地址打包分发
if (PROMA_API_URL.includes('localhost') && !process.env.ALLOW_LOCALHOST) {
  console.error('[build:agent-runtime] 错误：不允许使用 localhost 地址构建分发包！')
  console.error('[build:agent-runtime] 请在 .env 中设置正确的 PROMA_API_URL')
  console.error('[build:agent-runtime] 如确需本地调试，请设置环境变量 ALLOW_LOCALHOST=1')
  process.exit(1)
}

const buildOptions: esbuild.BuildOptions = {
  entryPoints: ['src/utility/agent-runtime.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/agent-runtime.cjs',
  external: [
    'electron',
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-agent-core',
    '@earendil-works/pi-ai',
    'sharp',
  ],
  define: {
    'process.env.PROMA_API_URL': JSON.stringify(PROMA_API_URL),
  },
}

if (isWatch) {
  const ctx = await esbuild.context(buildOptions)
  await ctx.watch()
  console.log('[build:agent-runtime] 监听文件变化中...')
} else {
  await esbuild.build(buildOptions)
}
