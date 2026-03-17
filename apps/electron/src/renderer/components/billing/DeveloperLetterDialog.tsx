/**
 * DeveloperLetterDialog - 开发者信封弹窗
 *
 * 信封翻开动画 → 信纸滑出 → 开发者声明 → 3项确认 → 立即订阅
 */

import * as React from 'react'
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
} from '@/components/ui/dialog'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DeveloperLetterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  selectedTierName: string
  loading: boolean
}

const CONFIRMATIONS = [
  '我已了解低价模型无法保证 100% 稳定性和性能，且不提供额外服务',
  '低价模型可能因上游供应问题无法保证随时可用',
  '我可以在需要时自行切换到 Proma 官方模型以获得最佳效果',
] as const

export function DeveloperLetterDialog({
  open,
  onOpenChange,
  onConfirm,
  selectedTierName,
  loading,
}: DeveloperLetterDialogProps): React.ReactElement {
  const [checked, setChecked] = React.useState<boolean[]>([false, false, false])

  const allChecked = checked.every(Boolean)

  // 打开时重置勾选状态
  React.useEffect(() => {
    if (open) {
      setChecked([false, false, false])
    }
  }, [open])

  const handleCheck = (index: number, value: boolean) => {
    setChecked((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-[50%] top-[50%] z-[100] w-full max-w-xl translate-x-[-50%] translate-y-[-50%] titlebar-no-drag',
            'focus:outline-none',
          )}
          onPointerDownOutside={() => onOpenChange(false)}
        >
          {/* 自定义 keyframes */}
          <style>{`
            @keyframes envelope-flap-open {
              0% { transform: rotateX(0deg); }
              100% { transform: rotateX(-180deg); }
            }
            @keyframes letter-slide-up {
              0% { transform: translateY(60%); opacity: 0; }
              100% { transform: translateY(0); opacity: 1; }
            }
            @keyframes envelope-fade-in {
              0% { opacity: 0; transform: scale(0.9); }
              100% { opacity: 1; transform: scale(1); }
            }
          `}</style>

          {/* 信封容器 */}
          <div
            className="relative mx-auto w-full max-w-md"
            style={{
              perspective: '800px',
              animation: 'envelope-fade-in 0.4s ease-out forwards',
            }}
          >
            {/* 信封体 */}
            <div className="relative rounded-b-2xl bg-[#d4a574] dark:bg-[#8b6914] shadow-2xl overflow-hidden">
              {/* 信封底部纹理 */}
              <div className="absolute inset-0 opacity-10 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(0,0,0,0.03)_10px,rgba(0,0,0,0.03)_20px)]" />

              {/* 信封内部（信纸滑出的背景） */}
              <div className="pt-6 pb-8 px-6">
                {/* 信纸 */}
                <div
                  className="relative bg-white dark:bg-stone-50 rounded-xl shadow-lg px-6 py-6"
                  style={{
                    animation: 'letter-slide-up 0.5s ease-out 0.6s both',
                  }}
                >
                  {/* 信纸内容 */}
                  <div className="space-y-4 text-stone-700">
                    <p className="text-base font-medium">你好，</p>

                    <div className="text-sm leading-relaxed space-y-3">
                      <p>
                        感谢你选择 <span className="font-semibold text-stone-900">{selectedTierName}</span> 方案。
                      </p>
                      <p>
                        在你开始订阅之前，我想和你坦诚地聊几句。
                      </p>
                      <p>
                        我希望能帮助大家快速上手 Agent 模式，同时把更多精力投入到 Proma 的持续迭代中。
                      </p>
                      <p>
                        其中最大的门槛之一就是价格，如果完全按照官网 API 的价格来，很多用户可能会望而却步。
                      </p>
                      <p>
                        AI 模型存在一个「不可能三角」—— <span className="font-medium text-stone-900">性能、稳定性、价格</span>，三者很难同时满足。低价模型（如 lc-claude-opus-4-6）换算下来相当于 <span className="font-medium text-stone-900">1 人民币 ≈ 1 美金</span> 的使用成本。之所以能以远低于官方的价格提供，是因为依赖第三方渠道。这意味着供应可能不稳定，性能也可能与官方有差异。
                      </p>
                      <p>
                        如果你在意性能和稳定性，建议在合适的场景下自行切换到我们正常官方模型（除 lc-* 外均为官方模型），以获得最佳效果。
                      </p>
                      <p className="text-right text-stone-500 text-xs pt-1">
                        —— Erlich，Proma 开发者
                      </p>
                    </div>

                    {/* 分隔线 */}
                    <div className="border-t border-stone-200 pt-4">
                      <p className="text-xs text-stone-500 mb-3">请确认以下事项：</p>
                      <div className="space-y-3">
                        {CONFIRMATIONS.map((text, i) => (
                          <label
                            key={i}
                            className="flex items-start gap-2.5 cursor-pointer group"
                          >
                            <Checkbox
                              checked={checked[i]}
                              onCheckedChange={(v) => handleCheck(i, v === true)}
                              className="mt-0.5 shrink-0"
                            />
                            <span className="text-xs leading-relaxed text-stone-600 group-hover:text-stone-800 transition-colors">
                              {text}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* 订阅按钮 */}
                    <Button
                      className="w-full"
                      size="sm"
                      disabled={!allChecked || loading}
                      onClick={() => {
                        if (allChecked) {
                          onConfirm()
                        }
                      }}
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      立即订阅
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* 信封盖（三角形翻页） */}
            <div
              className="absolute top-0 left-0 right-0 z-10"
              style={{
                transformOrigin: 'top center',
                animation: 'envelope-flap-open 0.6s ease-in-out 0.3s both',
                transformStyle: 'preserve-3d',
              }}
            >
              <div
                className="w-full bg-[#c49660] dark:bg-[#7a5a10]"
                style={{
                  clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
                  height: '80px',
                  backfaceVisibility: 'hidden',
                }}
              />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
