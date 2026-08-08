#!/usr/bin/env bun
/**
 * 主进程构建脚本
 *
 * 通过 esbuild define 将 PROMA_API_URL 注入到 bundle 中，
 * 确保打包后的 Electron 应用使用正确的 API 地址（不依赖运行时 .env）。
 *
 * Bun 自动加载 .env，所以构建时 process.env.PROMA_API_URL 直接可用。
 * 开发时修改 .env 后需重启构建/watch 才能生效。
 *
 * 使用：
 *   bun run scripts/build-main.ts           # 构建
 *   bun run scripts/build-main.ts --watch   # 监听模式
 */

import * as esbuild from 'esbuild'

const isWatch = process.argv.includes('--watch')

// 从环境变量读取 API 地址（Bun 自动加载 .env）
const PROMA_API_URL = process.env.PROMA_API_URL || 'https://api.proma.cool/api/v1'

console.log(`[build:main] PROMA_API_URL = ${PROMA_API_URL}`)

// 安全检查：防止误用 localhost 地址打包分发
if (PROMA_API_URL.includes('localhost') && !process.env.ALLOW_LOCALHOST) {
  console.error('[build:main] 错误：不允许使用 localhost 地址构建分发包！')
  console.error('[build:main] 请在 .env 中设置正确的 PROMA_API_URL')
  console.error('[build:main] 如确需本地调试，请设置环境变量 ALLOW_LOCALHOST=1')
  process.exit(1)
}

const buildOptions: esbuild.BuildOptions = {
  entryPoints: ['src/main/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/main.cjs',
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
  console.log('[build:main] 监听文件变化中...')
} else {
  await esbuild.build(buildOptions)
}
