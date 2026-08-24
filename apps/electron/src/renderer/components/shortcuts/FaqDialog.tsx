/**
 * FaqDialog - 全局 FAQ 弹窗。
 *
 * 左侧显示主题目录（可点击跳转），右侧按主题展示全部常见问题。
 * 数据与 Onboarding FAQ 页共用（faq-content.ts）。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { HelpCircle, X } from 'lucide-react'
import { faqDialogOpenAtom } from '@/atoms/faq-dialog'
import { FAQ_GROUPS } from '@/components/onboarding/faq-content'
import { iconButtonNoRingFocusClass } from '@/components/ui/icon-button-styles'
import { cn } from '@/lib/utils'

export function FaqDialog(): React.ReactElement {
  const open = useAtomValue(faqDialogOpenAtom)
  const setOpen = useSetAtom(faqDialogOpenAtom)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const scrollToGroup = (topic: string) => {
    const el = document.getElementById(`faq-dialog-${topic}`)
    if (!el || !scrollRef.current) return
    const container = scrollRef.current
    const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 16
    container.scrollTo({ top, behavior: 'smooth' })
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(value) => setOpen(value)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[81] flex h-[80vh] w-[min(860px,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900',
          )}
        >
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3.5 dark:border-neutral-800">
            <div className="flex items-center gap-2.5">
              <HelpCircle className="size-4 text-[#1b3f2d]" />
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">常见问题</h2>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-sm text-neutral-500 transition-colors',
                  'hover:bg-neutral-100 hover:text-neutral-700 focus-visible:bg-neutral-100 focus-visible:text-neutral-700',
                  'dark:hover:bg-neutral-800 dark:focus-visible:bg-neutral-800',
                  iconButtonNoRingFocusClass,
                )}
              >
                <X className="size-4" />
                <span className="sr-only">关闭</span>
              </button>
            </DialogPrimitive.Close>
          </div>

          {/* 内容：左侧目录 + 右侧问答 */}
          <div className="flex min-h-0 flex-1">
            {/* 左侧目录 */}
            <div className="hidden w-48 shrink-0 overflow-y-auto border-r border-neutral-200 px-3 py-4 md:block dark:border-neutral-800">
              <nav className="space-y-0.5">
                {FAQ_GROUPS.map((group) => (
                  <button
                    key={group.topic}
                    onClick={() => scrollToGroup(group.topic)}
                    className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-[13px] text-neutral-600 transition-colors hover:bg-[#1b3f2d]/5 hover:text-[#1b3f2d] dark:text-neutral-400 dark:hover:text-[#27513a]"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#1b3f2d]/40" />
                    {group.topic}
                  </button>
                ))}
              </nav>
            </div>

            {/* 右侧问答 */}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-8">
                {FAQ_GROUPS.map((group) => (
                  <section key={group.topic} aria-labelledby={`faq-dialog-${group.topic}`}>
                    <div className="flex items-end gap-2 border-b border-neutral-200 pb-2 dark:border-neutral-800">
                      <h3
                        id={`faq-dialog-${group.topic}`}
                        className="text-base font-semibold text-neutral-900 dark:text-neutral-100"
                      >
                        {group.topic}
                      </h3>
                    </div>
                    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {group.items.map((item) => (
                        <article key={item.q} className="py-3">
                          <h4 className="text-[13px] font-semibold leading-snug text-[#1b3f2d] dark:text-[#27513a]">
                            {item.q}
                          </h4>
                          <p className="mt-1.5 text-[13px] leading-6 text-neutral-600 dark:text-neutral-400">
                            {item.a}
                          </p>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
