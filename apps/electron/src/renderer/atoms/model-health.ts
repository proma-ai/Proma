/**
 * 模型健康状态 Atoms
 *
 * 管理渲染进程的模型健康数据
 */

import { atom } from 'jotai'
import type { ModelHealthSummary } from '@proma/shared'

// ===== 健康数据状态 =====

/** 健康数据列表 */
export const modelHealthDataAtom = atom<ModelHealthSummary[]>([])

/** 健康数据加载中 */
export const modelHealthLoadingAtom = atom<boolean>(false)

/** 健康数据错误信息 */
export const modelHealthErrorAtom = atom<string | null>(null)

// ===== 派生 Atoms =====

/** 根据模型 ID 获取健康摘要 */
export const modelHealthByIdAtom = atom((get) => {
  const data = get(modelHealthDataAtom)
  const map = new Map<string, ModelHealthSummary>()
  for (const item of data) {
    map.set(item.modelId, item)
  }
  return map
})

// ===== 初始化函数 =====

/**
 * 加载模型健康数据
 */
export async function loadModelHealth(
  setData: (data: ModelHealthSummary[]) => void,
  setLoading: (loading: boolean) => void,
  setError: (error: string | null) => void,
): Promise<void> {
  setLoading(true)
  setError(null)

  try {
    const result = await window.electronAPI.cloudBilling.getModelHealth()
    if (result.success && result.data) {
      setData(result.data)
    } else {
      setError(result.error ?? '获取健康数据失败')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    setError(message)
  } finally {
    setLoading(false)
  }
}

/**
 * 初始化健康数据监听
 *
 * 加载初始数据并订阅更新事件
 * 返回清理函数
 */
export function initializeModelHealth(
  setData: (data: ModelHealthSummary[]) => void,
  setLoading: (loading: boolean) => void,
  setError: (error: string | null) => void,
): () => void {
  // 加载初始数据
  loadModelHealth(setData, setLoading, setError)

  // 订阅更新事件
  const unsubscribe = window.electronAPI.cloudBilling.onModelHealthUpdated(() => {
    loadModelHealth(setData, setLoading, setError)
  })

  return unsubscribe
}
