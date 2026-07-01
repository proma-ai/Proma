/**
 * MemorySettings - 记忆设置页
 *
 * Chat 工具 tab 下的记忆区：
 *  - Nowledge Mem：本地优先记忆 + Agent 集成（仅展示配置提示词，不持久化任何凭证）
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { ExternalLink, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingsSection, SettingsCard } from './primitives'
import { agentWorkspacesAtom } from '@/atoms/agent-atoms'
import nowledgeMemPrompt from './nowledge-mem-prompt.md?raw'

/** Nowledge Mem · 本地优先记忆 + Agent 集成 */
function NowledgeMemSection(): React.ReactElement {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const [configuredSlugs, setConfiguredSlugs] = React.useState<string[]>([])
  const [copying, setCopying] = React.useState(false)

  // 检测哪些工作区的 mcp.json 里已经写入了 nowledge-mem 条目
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const results = await Promise.all(
        workspaces.map(async (ws) => {
          try {
            const caps = await window.electronAPI.getWorkspaceCapabilities(ws.slug)
            return caps.mcpServers.some((m) => m.name === 'nowledge-mem') ? ws.slug : null
          } catch (err) {
            console.error('[Nowledge Mem] 检查工作区能力失败:', ws.slug, err)
            return null
          }
        }),
      )
      if (!cancelled) {
        setConfiguredSlugs(results.filter((s): s is string => s !== null))
      }
    })()
    return () => { cancelled = true }
  }, [workspaces])

  const handleCopy = async (): Promise<void> => {
    setCopying(true)
    try {
      await navigator.clipboard.writeText(nowledgeMemPrompt)
      toast.success('已复制配置提示词，请粘贴到 Agent 模式输入框执行')
    } catch (error) {
      console.error('[Nowledge Mem] 复制失败:', error)
      toast.error('复制失败，请检查剪贴板权限')
    } finally {
      setCopying(false)
    }
  }

  const badge = configuredSlugs.length > 0 ? (
    <span
      className="inline-flex items-center gap-1 text-xs font-normal text-emerald-600 dark:text-emerald-400"
      title={`已配置工作区：${configuredSlugs.join('、')}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      已在 {configuredSlugs.length} 个工作区配置
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
      未配置
    </span>
  )

  return (
    <SettingsSection
      title={
        <span className="inline-flex items-center gap-2 flex-wrap">
          Nowledge Mem · 本地优先记忆
          {badge}
        </span>
      }
      description="本地客户端 + Agent 集成方案，记忆完全留在你自己机器上，跨会话自动注入与回写"
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          {/* 第 1 步：下载 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">第 1 步：下载并安装 Nowledge Mem 桌面客户端</p>
            <a
              href="https://mem.nowledge.co/zh"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs text-foreground hover:bg-muted transition-colors"
            >
              mem.nowledge.co/zh
              <ExternalLink size={10} />
            </a>
          </div>

          {/* 第 2 步：执行前 Set Up 清单 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">第 2 步：执行第三步的配置提示词前请确认</p>
            <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
              <li>已下载并安装 Nowledge Mem 桌面客户端（配置时无需登录或注册账号）</li>
              <li>已启动 Nowledge Mem，托盘 / Dock 中能看到运行图标</li>
              <li>Proma 已切换到 <span className="font-medium text-foreground">Agent 模式</span>（此提示词只能在 Agent 中执行）</li>
            </ul>
          </div>

          {/* 第 3 步：复制 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">第 3 步：复制配置提示词，粘贴到 Agent 输入框执行</p>
            <div className="flex items-center gap-3">
              <Button onClick={handleCopy} disabled={copying} size="sm">
                <Copy size={14} className="mr-1.5" />
                {copying ? '复制中...' : '复制配置提示词'}
              </Button>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">一键让 Agent 完成所有配置</span>，提示词包含 nmem CLI 安装、插件下载、MCP 与 Hooks 配置全流程
              </p>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              ⚠️ 提示词执行完成后需要 <span className="font-medium text-foreground">完全退出并重启 Proma</span>，MCP 与 Hooks 才会生效
            </p>
          </div>

          {/* 第 4 步：验证记忆闭环 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">第 4 步：重启后验证记忆是否打通</p>
            <p className="text-xs text-muted-foreground">
              在 Agent 模式中先用{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">/skill:distill-memory</code>{' '}
              让 Agent 记住一段对话内容，再开一个新会话用{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">/skill:search-memory</code>{' '}
              把它搜出来。能搜到即代表记忆系统已完整生效。
            </p>
          </div>

          {/* 平台支持说明 + 帮助链接 */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              💡 平台支持：macOS、Linux 主流支持；Windows 用户需在 Git Bash + uv 环境中尝试（实验性，未经 Nowledge 官方验证）
            </p>
            <p className="text-xs text-muted-foreground">
              📖 配置过程遇到问题？查看{' '}
              <a
                href="https://mem.nowledge.co/zh/docs/integrations/proma"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                Nowledge Mem · Proma 集成文档
                <ExternalLink size={10} />
              </a>
            </p>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

export function MemorySettings(): React.ReactElement {
  return (
    <div className="space-y-8">
      <NowledgeMemSection />
    </div>
  )
}
