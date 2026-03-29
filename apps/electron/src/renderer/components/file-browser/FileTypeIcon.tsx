/**
 * FileTypeIcon — 根据文件名/文件夹名渲染对应的 VS Code 风格图标
 *
 * 封装 @react-symbols/icons，统一尺寸和样式。
 */

import * as React from 'react'
import { FileIcon, FolderIcon } from '@react-symbols/icons/utils'

interface FileTypeIconProps {
  /** 文件名或文件夹名（如 "index.ts"、"node_modules"） */
  name: string
  /** 是否为目录 */
  isDirectory: boolean
  /** 目录是否展开（仅目录有效） */
  isOpen?: boolean
  /** 图标尺寸（像素），默认 16 */
  size?: number
  /** 额外 className */
  className?: string
}

export const FileTypeIcon = React.memo(function FileTypeIcon({
  name,
  isDirectory,
  size = 16,
  className,
}: FileTypeIconProps): React.ReactElement {
  if (isDirectory) {
    return (
      <span className={className} style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <FolderIcon folderName={name} width={size} height={size} />
      </span>
    )
  }

  return (
    <span className={className} style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <FileIcon fileName={name} autoAssign width={size} height={size} />
    </span>
  )
})
