/**
 * 文件处理工具函数
 */

import { MAX_ATTACHMENT_SIZE } from '@proma/shared'

export function formatFileNames(names: string[], max = 3): string {
  if (names.length <= max) return names.join('、')
  return `${names.slice(0, max).join('、')} 等 ${names.length} 个文件`
}

export function getFileParentPath(filePath: string): string | null {
  const slashIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  if (slashIndex < 0) return null
  if (slashIndex === 0) return filePath.slice(0, 1)
  if (/^[A-Za-z]:[\\/]/.test(filePath) && slashIndex === 2) {
    return filePath.slice(0, 3)
  }
  return filePath.slice(0, slashIndex)
}

/** 将 File 对象转为 base64 字符串 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_ATTACHMENT_SIZE) {
      reject(new Error(`文件 ${file.name} 超过 100MB 大小限制`))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]!
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
