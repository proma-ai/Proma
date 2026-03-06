/**
 * FeishuSettings - 飞书集成设置页
 *
 * 配置飞书 Bot 连接、默认参数、查看连接状态。
 * 包含创建飞书 Bot 的完整引导流程。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Loader2, CheckCircle2, XCircle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingsSection } from './primitives/SettingsSection'
import { SettingsCard } from './primitives/SettingsCard'
import { SettingsInput } from './primitives/SettingsInput'
import { SettingsSecretInput } from './primitives/SettingsSecretInput'
import { SettingsSelect } from './primitives/SettingsSelect'
import { SettingsSegmentedControl } from './primitives/SettingsSegmentedControl'
import { SettingsRow } from './primitives/SettingsRow'
import { feishuBridgeStateAtom } from '@/atoms/feishu-atoms'
import { agentWorkspacesAtom } from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'
import type { FeishuTestResult } from '@proma/shared'

/** 连接状态颜色映射 */
const STATUS_CONFIG = {
  disconnected: { color: 'bg-gray-400', label: '未连接' },
  connecting: { color: 'bg-yellow-400 animate-pulse', label: '连接中...' },
  connected: { color: 'bg-green-500', label: '已连接' },
  error: { color: 'bg-red-500', label: '连接错误' },
} as const

/** 通知模式选项 */
const NOTIFY_MODE_OPTIONS = [
  { value: 'auto', label: '智能' },
  { value: 'always', label: '始终' },
  { value: 'off', label: '关闭' },
]

/** 安全地用系统浏览器打开链接 */
function openLink(url: string): void {
  window.electronAPI.openExternal(url)
}

/** 可点击的外部链接组件 */
function Link({ href, children }: { href: string; children: React.ReactNode }): React.ReactElement {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer"
      onClick={() => openLink(href)}
    >
      {children}
      <ExternalLink className="size-3 flex-shrink-0" />
    </button>
  )
}

export function FeishuSettings(): React.ReactElement {
  const bridgeState = useAtomValue(feishuBridgeStateAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)

  // 表单状态
  const [appId, setAppId] = React.useState('')
  const [appSecret, setAppSecret] = React.useState('')
  const [defaultWorkspaceId, setDefaultWorkspaceId] = React.useState('')
  const [defaultNotifyMode, setDefaultNotifyMode] = React.useState('auto')

  // UI 状态
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [savingDefaults, setSavingDefaults] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<FeishuTestResult | null>(null)

  // 加载配置
  React.useEffect(() => {
    window.electronAPI.getFeishuConfig().then((config) => {
      setAppId(config.appId ?? '')
      // appSecret 不回显（加密态），留空表示不修改
      setDefaultWorkspaceId(config.defaultWorkspaceId ?? '')
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  // 工作区选项
  const workspaceOptions = React.useMemo(
    () => workspaces.map((w) => ({ value: w.id, label: w.name })),
    [workspaces]
  )

  // 保存配置
  const handleSave = React.useCallback(async () => {
    if (!appId.trim()) return

    setSaving(true)
    try {
      await window.electronAPI.saveFeishuConfig({
        enabled: true,
        appId: appId.trim(),
        appSecret: appSecret || '', // 空字符串时主进程保留原值
        defaultWorkspaceId: defaultWorkspaceId || undefined,
      })
    } finally {
      setSaving(false)
    }
  }, [appId, appSecret, defaultWorkspaceId])

  // 保存默认配置
  const handleSaveDefaults = React.useCallback(async () => {
    setSavingDefaults(true)
    try {
      await window.electronAPI.saveFeishuConfig({
        enabled: true,
        appId: appId.trim(),
        appSecret: '', // 空字符串 → 主进程保留原值
        defaultWorkspaceId: defaultWorkspaceId || undefined,
      })
    } finally {
      setSavingDefaults(false)
    }
  }, [appId, defaultWorkspaceId])

  // 测试连接
  const handleTestConnection = React.useCallback(async () => {
    if (!appId.trim() || !appSecret.trim()) {
      setTestResult({ success: false, message: '请填写 App ID 和 App Secret' })
      return
    }

    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.testFeishuConnection(appId.trim(), appSecret.trim())
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, message: `测试失败: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setTesting(false)
    }
  }, [appId, appSecret])

  // 启动/停止 Bridge
  const handleToggleBridge = React.useCallback(async () => {
    if (bridgeState.status === 'connected' || bridgeState.status === 'connecting') {
      await window.electronAPI.stopFeishuBridge()
    } else {
      await window.electronAPI.startFeishuBridge()
    }
  }, [bridgeState.status])

  const statusConfig = STATUS_CONFIG[bridgeState.status]
  const isConnected = bridgeState.status === 'connected' || bridgeState.status === 'connecting'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* 连接状态 */}
      <SettingsSection
        title="飞书集成"
        description="连接飞书机器人，在飞书中控制 Proma Agent"
      >
        <SettingsCard>
          <SettingsRow
            label="Bridge 状态"
            description={bridgeState.errorMessage ?? undefined}
          >
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className={cn('w-2 h-2 rounded-full', statusConfig.color)} />
                <span className="text-sm text-muted-foreground">{statusConfig.label}</span>
              </div>
              <Button
                size="sm"
                variant={isConnected ? 'destructive' : 'default'}
                onClick={handleToggleBridge}
                disabled={!appId}
              >
                {isConnected ? '停止' : '启动'}
              </Button>
            </div>
          </SettingsRow>
          {bridgeState.activeBindings > 0 && (
            <SettingsRow label="活跃绑定" description="当前连接的飞书聊天数">
              <span className="text-sm font-medium">{bridgeState.activeBindings}</span>
            </SettingsRow>
          )}
        </SettingsCard>
      </SettingsSection>

      {/* Bot 配置 */}
      <SettingsSection
        title="Bot 配置"
        description="从飞书开发者平台获取应用凭证"
      >
        <SettingsCard>
          <SettingsInput
            label="App ID"
            value={appId}
            onChange={setAppId}
            placeholder="cli_xxxxxxxxxx"
          />
          <SettingsSecretInput
            label="App Secret"
            value={appSecret}
            onChange={setAppSecret}
            placeholder="输入新的 App Secret（留空保留原值）"
          />
        </SettingsCard>

        <div className="flex items-center gap-3 mt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing || !appId.trim() || !appSecret.trim()}
          >
            {testing && <Loader2 size={14} className="animate-spin" />}
            <span>{testing ? '测试中...' : '测试连接'}</span>
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !appId.trim()}
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            <span>{saving ? '保存中...' : '保存配置'}</span>
          </Button>
        </div>

        {testResult && (
          <div className={cn(
            'mt-3 p-3 rounded-lg flex items-start gap-2 text-sm',
            testResult.success ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-500/10 text-red-700 dark:text-red-400'
          )}>
            {testResult.success
              ? <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" />
              : <XCircle size={16} className="flex-shrink-0 mt-0.5" />
            }
            <span>{testResult.message}{testResult.botName && ` — ${testResult.botName}`}</span>
          </div>
        )}
      </SettingsSection>

      {/* 默认配置 */}
      <SettingsSection
        title="默认配置"
        description="飞书发起新会话时使用的默认设置"
      >
        <SettingsCard>
          <SettingsSegmentedControl
            label="默认通知模式"
            description="智能: 离开时才发飞书 | 始终: 总是发 | 关闭: 从不发"
            value={defaultNotifyMode}
            onValueChange={setDefaultNotifyMode}
            options={NOTIFY_MODE_OPTIONS}
          />
          {workspaceOptions.length > 0 && (
            <SettingsSelect
              label="默认工作区"
              value={defaultWorkspaceId}
              onValueChange={setDefaultWorkspaceId}
              options={workspaceOptions}
              placeholder="选择工作区"
            />
          )}
        </SettingsCard>

        <div className="flex items-center mt-3">
          <Button
            size="sm"
            onClick={handleSaveDefaults}
            disabled={savingDefaults}
          >
            {savingDefaults && <Loader2 size={14} className="animate-spin" />}
            <span>{savingDefaults ? '保存中...' : '保存默认配置'}</span>
          </Button>
        </div>
      </SettingsSection>

      {/* 创建飞书 Bot 引导 */}
      <SettingsSection
        title="创建飞书 Bot"
        description="首次使用？按以下步骤在飞书开放平台创建机器人应用"
      >
        <SettingsCard divided={false}>
          <div className="px-4 py-4 space-y-5 text-sm">
            {/* 步骤 1 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">1</span>
                <span className="font-medium text-foreground">创建自建应用</span>
              </div>
              <p className="pl-7 text-muted-foreground">
                前往{' '}
                <Link href="https://open.feishu.cn/app">飞书开放平台</Link>
                {' '}（海外版：
                <Link href="https://open.larksuite.com/app">Lark 开放平台</Link>
                ），点击「创建自建应用」，填写应用名称和描述。
              </p>
            </div>

            {/* 步骤 2 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">2</span>
                <span className="font-medium text-foreground">获取凭证</span>
              </div>
              <p className="pl-7 text-muted-foreground">
                进入应用详情页，在「凭证与基础信息」中找到{' '}
                <span className="text-foreground font-medium">App ID</span> 和{' '}
                <span className="text-foreground font-medium">App Secret</span>，
                复制到上方的配置表单中。
              </p>
            </div>

            {/* 步骤 3 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">3</span>
                <span className="font-medium text-foreground">启用机器人能力</span>
              </div>
              <p className="pl-7 text-muted-foreground">
                进入「添加应用能力」页面，启用「机器人」能力。
                这样应用才能接收和发送飞书消息。
              </p>
            </div>

            {/* 步骤 4 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">4</span>
                <span className="font-medium text-foreground">配置权限</span>
              </div>
              <div className="pl-7 space-y-1.5 text-muted-foreground">
                <p>
                  进入「权限管理」页面
                  ，逐个复制搜索，添加以下权限（也可通过批量开通接口一键添加）：
                </p>
                <div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-0.5">
                  <div><span className="text-foreground/70">im:message</span> — 获取与发送单聊、群组消息</div>
                  <div><span className="text-foreground/70">im:message:send_as_bot</span> — 以机器人身份发送消息</div>
                  <div><span className="text-foreground/70">im:chat:readonly</span> — 获取群组信息</div>
                  <div><span className="text-foreground/70">im:resource</span> — 获取消息中的资源文件</div>
                </div>
              </div>
            </div>

            {/* 步骤 5 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">5</span>
                <span className="font-medium text-foreground">配置事件订阅（关键步骤）</span>
              </div>
              <div className="pl-7 space-y-1.5 text-muted-foreground">
                <p>
                  进入「事件与回调」页面：
                </p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>
                    事件订阅方式选择{' '}
                    <span className="text-foreground font-medium">「使用长连接接收事件」</span>
                    （而非 Webhook，无需公网 IP）
                  </li>
                  <li>
                    添加事件{' '}
                    <code className="bg-muted/50 px-1.5 py-0.5 rounded text-xs text-foreground/80">im.message.receive_v1</code>
                    {' '}（接收消息）
                  </li>
                </ol>
              </div>
            </div>

            {/* 步骤 6 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">6</span>
                <span className="font-medium text-foreground">发布应用</span>
              </div>
              <p className="pl-7 text-muted-foreground">
                进入「版本管理与发布」→ 创建版本 → 提交审核。
                需要企业管理员在{' '}
                <Link href="https://feishu.cn/admin">管理后台</Link>
                {' '}审核通过后，机器人才能正常使用。
              </p>
            </div>

            {/* 提示 */}
            <div className="pl-7 p-3 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs">
              版本审核通过并发布后，在飞书中搜索机器人名称添加到聊天，
              即可通过飞书向 Proma Agent 发送指令。
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* 飞书命令使用说明 */}
      <SettingsSection
        title="飞书命令"
        description="在飞书中向 Bot 发送以下命令"
      >
        <SettingsCard divided={false}>
          <div className="px-4 py-3 space-y-2 text-sm text-muted-foreground">
            <div className="grid grid-cols-[100px_1fr] gap-y-1.5 gap-x-4">
              <code className="text-foreground/80 font-mono">/help</code>
              <span>显示帮助</span>
              <code className="text-foreground/80 font-mono">/new</code>
              <span>创建新 Agent 会话</span>
              {/* <code className="text-foreground/80 font-mono">/chat</code>
              <span>切换到 Chat 模式</span> */}
              <code className="text-foreground/80 font-mono">/agent</code>
              <span>切换到 Agent 模式</span>
              <code className="text-foreground/80 font-mono">/list</code>
              <span>列出所有会话</span>
              <code className="text-foreground/80 font-mono">/stop</code>
              <span>停止当前 Agent</span>
              <code className="text-foreground/80 font-mono">/switch</code>
              <span>切换到已有会话（序号）</span>
              <code className="text-foreground/80 font-mono">/workspace</code>
              <span>设置默认工作区</span>
            </div>
            <p className="pt-2 text-xs">
              直接发送文本会自动创建新会话或发送到当前绑定的会话。
            </p>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
