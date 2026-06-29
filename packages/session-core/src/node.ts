/**
 * @proma/session-core/node — Node 侧子入口（含文件 IO，import 'node:fs'）。
 *
 * 仅供 proma CLI 与 Electron 主进程使用。**不要**从浏览器/渲染层 import 本入口，
 * 否则 Vite 会把 node:fs 打进 bundle 导致运行时报错。浏览器侧请用主入口
 * '@proma/session-core'（纯函数）。
 */
export { readSessionMessages } from './read-fs'
