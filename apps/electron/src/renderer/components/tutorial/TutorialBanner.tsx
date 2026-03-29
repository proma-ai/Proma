/**
 * TutorialBanner - 教程推荐横幅
 *
 * 固定在右下角的浮动卡片，引导用户查看教程。
 * - 不区分新老用户，使用 tutorialBannerDismissed 字段控制
 * - 用户点击「立即学习」或「稍后再学」后永不再显示
 * - 明确告知教程的下次访问位置：设置 > 教程
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { GraduationCap, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { settingsTabAtom, settingsOpenAtom } from '@/atoms/settings-tab'

export function TutorialBanner(): React.ReactElement | null {
  const [visible, setVisible] = React.useState(false)
  const [dismissed, setDismissed] = React.useState(true)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)

  // 初始化：从主进程读取 settings 判断是否需要显示
  React.useEffect(() => {
    window.electronAPI
      .getSettings()
      .then((settings) => {
        if (!settings.tutorialBannerDismissed) {
          setDismissed(false)
          // 延迟 1.5 秒显示，避免页面加载时的干扰
          setTimeout(() => setVisible(true), 1500)
        }
      })
      .catch(console.error)
  }, [])

  // 关闭横幅并持久化
  const handleDismiss = async () => {
    setVisible(false)
    await window.electronAPI.updateSettings({ tutorialBannerDismissed: true })
  }

  // 立即学习：跳转到设置教程页并关闭横幅
  const handleLearnNow = async () => {
    setSettingsTab('tutorial')
    setSettingsOpen(true)
    await handleDismiss()
  }

  // 稍后再学：关闭横幅
  const handleLater = async () => {
    await handleDismiss()
  }

  if (dismissed) return null

  return (
    <div
      className={`fixed bottom-6 right-6 z-[100] w-[340px] transition-all duration-500 ease-out ${
        visible
          ? 'translate-x-0 opacity-100'
          : 'translate-x-8 opacity-0 pointer-events-none'
      }`}
    >
      <div className="relative rounded-2xl bg-gradient-to-br from-primary/5 via-background to-primary/10 border border-primary/15 shadow-lg shadow-primary/5 backdrop-blur-sm p-5">
        {/* 关闭按钮 */}
        <button
          onClick={handleLater}
          className="absolute top-3 right-3 p-1 rounded-lg text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5 transition-colors"
        >
          <X size={14} />
        </button>

        {/* 图标 + 标题 */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <GraduationCap size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Proma 使用教程</h3>
            <p className="text-xs text-muted-foreground mt-0.5">了解 Proma 的全部功能和使用技巧</p>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleLearnNow}
            className="flex-1 h-8 text-xs"
          >
            立即学习
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleLater}
            className="h-8 text-xs text-muted-foreground"
          >
            稍后再学
          </Button>
        </div>

        {/* 提示文字 */}
        <p className="text-[11px] text-muted-foreground/60 mt-3 text-center">
          你可以随时在 设置 &gt; 教程 中查看完整教程
        </p>
      </div>
    </div>
  )
}
