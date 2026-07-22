/**
 * useDefaultAppForFile — 探测本机为文件类型注册的默认 App，并缓存。
 *
 * 跨组件共用：预览面板顶栏按钮、文件浏览器三点菜单等都通过此 hook 拿到 App 信息。
 * 成功结果按文件后缀缓存；探测失败不缓存，避免临时系统异常长期隐藏打开入口。
 */

import * as React from 'react'
import type { DefaultAppInfo, FileAccessOptions } from '@proma/shared'

const rendererCache = new Map<string, DefaultAppInfo>()

function extKeyOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : filePath
}

export function useDefaultAppForFile(
  filePath: string | null | undefined,
  access?: FileAccessOptions,
): DefaultAppInfo | null {
  const [info, setInfo] = React.useState<DefaultAppInfo | null>(() => {
    if (!filePath) return null
    return rendererCache.get(extKeyOf(filePath)) ?? null
  })

  React.useEffect(() => {
    if (!filePath) {
      setInfo(null)
      return
    }
    let cancelled = false
    const key = extKeyOf(filePath)
    const cached = rendererCache.get(key)
    if (cached !== undefined) {
      setInfo(cached)
      return
    }
    window.electronAPI
      .getDefaultAppForFile(filePath, access)
      .then((result) => {
        if (cancelled) return
        console.log('[useDefaultAppForFile] IPC 返回:', filePath, result ? `name=${result.name}` : 'null')
        if (result) rendererCache.set(key, result)
        setInfo(result)
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[useDefaultAppForFile] IPC 报错:', filePath, err)
        setInfo(null)
      })
    return () => {
      cancelled = true
    }
  }, [filePath, access])

  return info
}
