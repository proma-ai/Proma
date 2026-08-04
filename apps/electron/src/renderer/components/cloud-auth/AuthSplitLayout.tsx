import type * as React from 'react'
import hopperSeasideWhiteHouse from '@/assets/onboarding/hopper-seaside-white-house.png'
import promaMarkWhite from '@/assets/onboarding/proma-mark-white.svg'

interface AuthSplitLayoutProps {
  children: React.ReactNode
}

/**
 * Cloud 认证统一视觉壳。
 * 与新版 Onboarding 欢迎页共享同一幅画作、品牌区和左右空间比例，
 * 仅替换右侧内容以保持登录、注册和验证流程的一致性。
 */
export function AuthSplitLayout({ children }: AuthSplitLayoutProps): React.ReactElement {
  return (
    <div className="flex min-h-full flex-col overflow-hidden bg-[#fbf9f7] antialiased xl:min-h-screen xl:flex-row">
      <aside className="relative h-56 shrink-0 overflow-hidden bg-[#d9e0e4] xl:h-auto xl:w-[calc(58%+100px)]">
        <img
          src={hopperSeasideWhiteHouse}
          alt="海边的白色小屋画作"
          className="absolute inset-0 h-full w-full object-cover object-center outline outline-1 outline-black/10"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-black/15 md:bg-gradient-to-tr md:from-black/60 md:via-transparent md:to-black/20" />

        <div className="absolute left-6 top-6 flex items-center gap-3 md:left-10 md:top-8">
          <img
            src={promaMarkWhite}
            alt="Proma"
            className="h-8 w-8 object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
          />
          <span className="text-lg font-light tracking-wide text-white">Proma</span>
        </div>

        <div className="absolute bottom-6 left-6 right-6 md:bottom-10 md:left-10 md:right-10">
          <p className="text-balance text-lg font-light leading-snug text-white md:text-2xl">
            让协作自然发生，让想法流动成形。
          </p>
          <p className="mt-2 text-[11px] uppercase tracking-[0.3em] text-white/70 md:text-xs">
            Local-first AI Agent
          </p>
        </div>
      </aside>

      <main className="flex min-h-[calc(100vh-14rem)] flex-1 items-center justify-center overflow-y-auto px-5 py-10 md:px-10 xl:min-h-screen">
        {children}
      </main>
    </div>
  )
}
