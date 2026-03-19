/**
 * ModelHealthInitializer - 模型健康数据初始化组件
 *
 * 在应用启动时加载健康数据并订阅更新事件。
 * 仅在 Cloud 模式且使用官方渠道时启用。
 */

import * as React from 'react'
import { useSetAtom, useAtomValue } from 'jotai'
import {
  modelHealthDataAtom,
  modelHealthLoadingAtom,
  modelHealthErrorAtom,
  initializeModelHealth,
} from '@/atoms/model-health'
import { cloudUserAtom } from '@/atoms/cloud-auth'
import { isCloudMode } from '@/lib/mode'

export function ModelHealthInitializer(): null {
  const setData = useSetAtom(modelHealthDataAtom)
  const setLoading = useSetAtom(modelHealthLoadingAtom)
  const setError = useSetAtom(modelHealthErrorAtom)
  const user = useAtomValue(cloudUserAtom)

  React.useEffect(() => {
    // 仅在 Cloud 模式且已登录时加载健康数据
    if (!isCloudMode() || !user) return

    const cleanup = initializeModelHealth(setData, setLoading, setError)
    return cleanup
  }, [user, setData, setLoading, setError])

  return null
}
