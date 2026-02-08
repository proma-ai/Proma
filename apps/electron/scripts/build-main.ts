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
const PROMA_API_URL = process.env.PROMA_API_URL || 'http://localhost:8000/api/v1'

console.log(`[build:main] PROMA_API_URL = ${PROMA_API_URL}`)

const buildOptions: esbuild.BuildOptions = {
  entryPoints: ['src/main/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/main.cjs',
  external: ['electron', '@anthropic-ai/claude-agent-sdk', 'electron-updater'],
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
