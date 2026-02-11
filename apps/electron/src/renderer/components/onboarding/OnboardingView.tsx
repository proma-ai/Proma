/**
 * Onboarding 视图组件
 *
 * 首次启动时显示的全屏引导界面，用于检查运行环境
 */

import { useState, useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { RefreshCw, Info } from 'lucide-react'
import type { EnvironmentCheckResult } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EnvironmentCheckCard } from '@/components/environment/EnvironmentCheckCard'
import {
  environmentCheckResultAtom,
  isCheckingEnvironmentAtom,
} from '@/atoms/environment'

interface OnboardingViewProps {
  /** 完成回调（进入主界面） */
  onComplete: () => void
}

/**
 * Onboarding 视图
 */
export function OnboardingView({ onComplete }: OnboardingViewProps) {
  const setEnvironmentResult = useSetAtom(environmentCheckResultAtom)
  const setIsChecking = useSetAtom(isCheckingEnvironmentAtom)

  const [result, setResult] = useState<EnvironmentCheckResult | null>(null)
  const [isChecking, setCheckingState] = useState(true)
  const [showSkipDialog, setShowSkipDialog] = useState(false)

  // 执行环境检测
  const checkEnvironment = async () => {
    setCheckingState(true)
    setIsChecking(true)

    try {
      const checkResult = await window.electronAPI.checkEnvironment()
      setResult(checkResult)
      setEnvironmentResult(checkResult)
    } catch (error) {
      console.error('[Onboarding] 环境检测失败:', error)
    } finally {
      setCheckingState(false)
      setIsChecking(false)
    }
  }

  // 初始化时自动检测
  useEffect(() => {
    checkEnvironment()
  }, [])

  // 完成 Onboarding
  const handleComplete = async () => {
    await window.electronAPI.updateSettings({
      onboardingCompleted: true,
      environmentCheckSkipped: false,
    })
    onComplete()
  }

  // 跳过设置
  const handleSkip = async () => {
    await window.electronAPI.updateSettings({
      onboardingCompleted: true,
      environmentCheckSkipped: true,
    })
    setShowSkipDialog(false)
    onComplete()
  }

  // 判断环境是否通过
  const canComplete = result && !result.hasIssues

  // Node.js 检测状态
  const nodejsStatus = !result
    ? 'checking'
    : result.nodejs.installed && result.nodejs.meetsMinimum
      ? result.nodejs.meetsRecommended
        ? 'success'
        : 'warning'
      : 'error'

  // Git 检测状态
  const gitStatus = !result
    ? 'checking'
    : result.git.installed && result.git.meetsRequirement
      ? 'success'
      : 'error'

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-8">
      {/* 顶部区域 */}
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold mb-4">欢迎使用 Proma</h1>
        <p className="text-lg text-muted-foreground">
          让我们先检查运行环境，确保 Agent 模式正常工作
        </p>
      </div>

      {/* 检测卡片区域 */}
      <div className="w-full max-w-2xl space-y-3 mb-8">
        {/* Node.js 检测卡片 */}
        <EnvironmentCheckCard
          name="Node.js"
          status={nodejsStatus}
          version={result?.nodejs.version}
          requirement="推荐 22 LTS，最低 18 LTS"
          downloadUrl={result?.nodejs.downloadUrl || 'https://nodejs.org/'}
          statusText={
            result && nodejsStatus === 'warning'
              ? `v${result.nodejs.version} (建议升级到 22 LTS 以获得最佳体验)`
              : undefined
          }
        />

        {/* Git 检测卡片 */}
        <EnvironmentCheckCard
          name="Git"
          status={gitStatus}
          version={result?.git.version}
          requirement="版本 >= 2.0"
          downloadUrl={result?.git.downloadUrl || 'https://git-scm.com/'}
        />

        {/* Windows 提示 */}
        {result?.platform === 'win32' && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>Windows 用户建议：</strong>
              安装时请选择默认路径（C:\Program Files\...），并确保勾选"添加到 PATH"选项
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* 底部操作栏 */}
      <div className="flex gap-4">
        <Button
          variant="ghost"
          onClick={() => setShowSkipDialog(true)}
          disabled={isChecking}
        >
          稍后设置
        </Button>

        <Button
          variant="secondary"
          onClick={checkEnvironment}
          disabled={isChecking}
        >
          {isChecking ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              检测中...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              重新检查
            </>
          )}
        </Button>

        <Button onClick={handleComplete} disabled={!canComplete || isChecking}>
          完成
        </Button>
      </div>

      {/* 跳过确认对话框 */}
      <AlertDialog open={showSkipDialog} onOpenChange={setShowSkipDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定要稍后设置吗？</AlertDialogTitle>
            <AlertDialogDescription>
              跳过环境检测可能导致 Agent 模式无法正常使用。你可以随时在设置中完成环境配置。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleSkip}>确定跳过</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
