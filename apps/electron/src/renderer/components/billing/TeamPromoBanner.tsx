/**
 * TeamPromoBanner - 团队版推广文字条
 *
 * 展示在订阅计划卡片下方，点击整条复制微信号 geekthings 到剪贴板
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Users, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { copyTextToClipboard } from '@/lib/clipboard'

export const PROMA_CONTACT_WECHAT_ID = 'geekthings'

export function TeamPromoBanner(): React.ReactElement {
  const handleClick = async (): Promise<void> => {
    try {
      await copyTextToClipboard(PROMA_CONTACT_WECHAT_ID)
      toast.success(`已复制微信号 ${PROMA_CONTACT_WECHAT_ID}`, {
        description: '添加后即可开通团队额度与企业 Skills 共享协作',
      })
    } catch {
      toast.message(`请手动复制微信号：${PROMA_CONTACT_WECHAT_ID}`)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'group w-full flex items-center gap-3 px-4 py-3 rounded-2xl',
        'bg-gradient-to-r from-emerald-50/70 to-teal-50/70',
        'dark:from-emerald-950/30 dark:to-teal-950/30',
        'border border-emerald-200/60 dark:border-emerald-800/40',
        'backdrop-blur-sm transition-all',
        'hover:border-emerald-300/80 dark:hover:border-emerald-700/60',
        'hover:shadow-sm cursor-pointer text-left',
      )}
    >
      <div className="shrink-0 w-8 h-8 rounded-full bg-emerald-100/80 dark:bg-emerald-900/40 flex items-center justify-center">
        <Users size={15} className="text-emerald-700 dark:text-emerald-300" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-emerald-900 dark:text-emerald-100">
          Proma 团队版：额度与 Skills 协作
        </p>
        <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/70 mt-0.5">
          团队额度自动分配与共享；管理员可集中发布包含关联文件的企业 Skills，成员可浏览、手动安装和更新，沉淀团队 SOP 与工具流程（需满足三人以上使用，团队版 ¥1000 起购买，赠送 10% 额度）· 点击复制微信号 <span className="font-mono font-semibold">{PROMA_CONTACT_WECHAT_ID}</span> 联系开通
        </p>
      </div>

      <Copy
        size={14}
        className="shrink-0 text-emerald-600/70 dark:text-emerald-400/70 group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors"
      />
    </button>
  )
}
