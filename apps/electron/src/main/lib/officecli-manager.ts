/**
 * OfficeCLI 内嵌资源路径
 *
 * OfficeCLI 由构建脚本下载、校验并交给 electron-builder 随应用分发；运行时不读取
 * 用户 PATH，也不提供下载/安装设置。若资源因构建或签名问题不可用，调用方回退到
 * Proma 原有的内置 OOXML 解析器。
 */

import { join } from 'node:path'

const OFFICECLI_COMMAND = process.platform === 'win32' ? 'officecli.exe' : 'officecli'

export function getBundledOfficeCliPath(): string {
  const { app } = require('electron') as { app: { isPackaged: boolean } }
  const resourcesDir = app.isPackaged
    ? process.resourcesPath
    : join(__dirname, 'resources')
  return join(resourcesDir, 'officecli', OFFICECLI_COMMAND)
}
