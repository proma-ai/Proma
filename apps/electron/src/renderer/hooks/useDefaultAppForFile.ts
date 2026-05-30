/**
 * useDefaultAppForFile — 探测本机为文件类型注册的默认 App，并缓存。
 *
 * 跨组件共用：预览面板顶栏按钮、文件浏览器三点菜单等都通过此 hook 拿到 App 信息。
 * 缓存按文件后缀维度，进程内一直有效——切换默认 App 后下次启动 dev/window 生效。
 */

import * as React from 'react'
import type { DefaultAppInfo, FileAccessOptions } from '@proma/shared'

const rendererCache = new Map<string, DefaultAppInfo | null>()

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
        // 带访问上下文时，null 可能来自路径授权失败，不能污染按后缀共享的默认 App 缓存。
        if (result || !access) rendererCache.set(key, result)
        setInfo(result)
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[useDefaultAppForFile] IPC 报错:', filePath, err)
        rendererCache.set(key, null)
        setInfo(null)
      })
    return () => {
      cancelled = true
    }
  }, [filePath, access])

  return info
}
