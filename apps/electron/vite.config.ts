import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __PROMA_MODE__: JSON.stringify('cloud'),
  },
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@/types': resolve(__dirname, 'src/types'),
      '@': resolve(__dirname, 'src/renderer'),
    },
    // 强制 ProseMirror / TipTap 底层包只解析到单一实例。
    // bun 的隔离式 node_modules 可能残留多版本 @tiptap/pm 与 prosemirror-*，
    // 一旦同时加载就会触发 "multiple versions of prosemirror-model were loaded"，
    // 导致 mention 节点 schema 不匹配、回车选中 Skill/MCP 报 Fragment 转换错误。
    dedupe: [
      '@tiptap/pm',
      'prosemirror-model',
      'prosemirror-state',
      'prosemirror-view',
      'prosemirror-transform',
      'prosemirror-keymap',
      'prosemirror-commands',
    ],
  },
  server: {
    port: 5173,
    strictPort: true, // 确保使用指定端口，如被占用则报错
    open: false,
  },
})
