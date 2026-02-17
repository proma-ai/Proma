/**
 * useBackgroundTasks — 后台任务管理 Hook
 *
 * 管理 Agent 会话的后台任务列表（Agent 任务和 Shell 任务）。
 * 职责：
 * - 添加/更新/移除后台任务
 * - 停止任务（通过 IPC）
 */

import { useAtom } from 'jotai'
import { useCallback } from 'react'
import {
  backgroundTasksAtomFamily,
  type BackgroundTask,
} from '@/atoms/agent-atoms'

export interface UseBackgroundTasksResult {
  /** 当前会话的后台任务列表 */
  tasks: BackgroundTask[]

  /** 添加后台任务 */
  addTask: (task: Omit<BackgroundTask, 'elapsedSeconds'>) => void

  /** 更新任务进度 */
  updateTaskProgress: (toolUseId: string, elapsedSeconds: number) => void

  /** 移除后台任务 */
  removeTask: (toolUseId: string) => void

  /** 停止任务 */
  stopTask: (taskId: string, type: 'agent' | 'shell') => Promise<void>
}

/**
 * 后台任务管理 Hook
 *
 * @param sessionId - 会话 ID，用于隔离任务列表
 */
export function useBackgroundTasks(sessionId: string): UseBackgroundTasksResult {
  const [tasks, setTasks] = useAtom(backgroundTasksAtomFamily(sessionId))

  /**
   * 添加后台任务
   *
   * 防止重复添加（根据 toolUseId 判断）。
   */
  const addTask = useCallback(
    (task: Omit<BackgroundTask, 'elapsedSeconds'>) => {
      setTasks((prev) => {
        // 防止重复添加
        if (prev.some((t) => t.toolUseId === task.toolUseId)) {
          return prev
        }
        return [...prev, { ...task, elapsedSeconds: 0 }]
      })
    },
    [setTasks]
  )

  /**
   * 更新任务进度
   *
   * 通过 task_progress 事件更新 elapsedSeconds。
   */
  const updateTaskProgress = useCallback(
    (toolUseId: string, elapsedSeconds: number) => {
      setTasks((prev) =>
        prev.map((t) => (t.toolUseId === toolUseId ? { ...t, elapsedSeconds } : t))
      )
    },
    [setTasks]
  )

  /**
   * 移除后台任务
   *
   * 任务完成或被停止时调用。
   */
  const removeTask = useCallback(
    (toolUseId: string) => {
      setTasks((prev) => prev.filter((t) => t.toolUseId !== toolUseId))
    },
    [setTasks]
  )

  /**
   * 停止任务
   *
   * 通过 IPC 调用主进程停止任务。
   * 停止成功后，自动从列表中移除任务。
   */
  const stopTask = useCallback(
    async (taskId: string, type: 'agent' | 'shell') => {
      try {
        await window.electronAPI.stopTask({
          sessionId,
          taskId,
          type,
        })

        // 停止成功后，通过 toolUseId 移除任务
        const task = tasks.find((t) => t.id === taskId)
        if (task) {
          removeTask(task.toolUseId)
        }
      } catch (error) {
        console.error('[useBackgroundTasks] 停止任务失败:', error)
        throw error
      }
    },
    [sessionId, tasks, removeTask]
  )

  return {
    tasks,
    addTask,
    updateTaskProgress,
    removeTask,
    stopTask,
  }
}
