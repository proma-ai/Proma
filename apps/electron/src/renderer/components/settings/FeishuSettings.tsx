/**
 * FeishuSettings - 飞书集成设置页
 *
 * 双 Tab 布局：
 * - Bot 配置：飞书应用凭证、连接状态、默认配置、创建引导、命令说明
 * - 绑定管理：查看/管理所有活跃的飞书聊天绑定（群聊/单聊的工作区/会话分配）
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, XCircle, ExternalLink, Users, User, Trash2, RefreshCw, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { SettingsSection } from './primitives/SettingsSection'
import { SettingsCard } from './primitives/SettingsCard'
import { SettingsInput } from './primitives/SettingsInput'
import { SettingsSecretInput } from './primitives/SettingsSecretInput'
import { SettingsSelect } from './primitives/SettingsSelect'
import { SettingsSegmentedControl } from './primitives/SettingsSegmentedControl'
import { SettingsRow } from './primitives/SettingsRow'
import { feishuBridgeStateAtom, feishuBindingsAtom } from '@/atoms/feishu-atoms'
import { agentWorkspacesAtom, agentSessionsAtom } from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'
import type { FeishuTestResult, FeishuChatBinding } from '@proma/shared'

// ===== 常量 =====

type FeishuTab = 'config' | 'bindings'

const TAB_OPTIONS: Array<{ value: FeishuTab; label: string }> = [
  { value: 'config', label: 'Bot 配置' },
  { value: 'bindings', label: '绑定管理' },
]

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

/** 飞书批量权限配置 JSON（用于一键复制粘贴到飞书开放平台） */
const FEISHU_SCOPES_JSON = JSON.stringify({
  scopes: {
    tenant: [
      'contact:contact.base:readonly',
      'im:chat:readonly',
      'im:chat.members:read',
      'im:message',
      'im:message.group_at_msg:readonly',
      'im:message.group_msg',
      'im:message.p2p_msg:readonly',
      'im:message:send_as_bot',
      'im:resource',
    ],
    user: [],
  },
}, null, 2)

// ===== 工具组件 =====

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

// ===== 权限配置步骤组件 =====

/** 权限列表展示 + 一键复制批量权限 JSON */
function PermissionsStep(): React.ReactElement {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = React.useCallback(() => {
    navigator.clipboard.writeText(FEISHU_SCOPES_JSON).then(() => {
      setCopied(true)
      toast.success('权限配置已复制到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      toast.error('复制失败')
    })
  }, [])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">4</span>
        <span className="font-medium text-foreground">配置权限</span>
      </div>
      <div className="pl-7 space-y-2 text-muted-foreground">
        <p>
          进入「权限管理」页面，点击下方按钮复制权限配置 JSON，
          然后在飞书开放平台通过「批量开通」粘贴即可一键添加所有权限：
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={handleCopy}
          className="gap-1.5"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? '已复制' : '复制批量权限配置'}</span>
        </Button>
        <div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-0.5">
          <div><span className="text-foreground/70">im:message</span> — 获取与发送单聊、群组消息</div>
          <div><span className="text-foreground/70">im:message:send_as_bot</span> — 以机器人身份发送消息</div>
          <div><span className="text-foreground/70">im:message.p2p_msg:readonly</span> — 接收用户发给机器人的单聊消息</div>
          <div><span className="text-foreground/70">im:message.group_at_msg:readonly</span> — 接收群聊中 @机器人 的消息</div>
          <div><span className="text-foreground/70">im:message.group_msg</span> — 读取群聊历史消息（群聊上下文）</div>
          <div><span className="text-foreground/70">im:chat:readonly</span> — 获取群组信息</div>
          <div><span className="text-foreground/70">im:chat.members:read</span> — 获取群成员列表（支持 @某人）</div>
          <div><span className="text-foreground/70">im:resource</span> — 获取消息中的资源文件（图片、文档等）</div>
          <div><span className="text-foreground/70">contact:contact.base:readonly</span> — 获取用户基本信息（群聊发送者名称）</div>
        </div>
      </div>
    </div>
  )
}

// ===== 绑定卡片组件 =====

interface FeishuBindingCardProps {
  binding: FeishuChatBinding
  onUpdate: (chatId: string, updates: { workspaceId?: string; sessionId?: string }) => void
  onRemove: (chatId: string) => void
}

function FeishuBindingCard({ binding, onUpdate, onRemove }: FeishuBindingCardProps): React.ReactElement {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const sessions = useAtomValue(agentSessionsAtom)

  const isGroup = binding.chatType === 'group'
  const displayName = isGroup ? (binding.groupName ?? '未知群组') : '单聊'

  // 当前绑定工作区下的会话列表
  const workspaceSessions = React.useMemo(
    () => sessions.filter((s) => s.workspaceId === binding.workspaceId),
    [sessions, binding.workspaceId]
  )

  const currentWorkspace = workspaces.find((w) => w.id === binding.workspaceId)
  const currentSession = sessions.find((s) => s.id === binding.sessionId)

  return (
    <div className="px-4 py-3 space-y-3">
      {/* 头部：类型图标 + 名称 + 删除 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={cn(
            'flex items-center justify-center w-8 h-8 rounded-lg',
            isGroup ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-green-500/10 text-green-600 dark:text-green-400'
          )}>
            {isGroup ? <Users size={16} /> : <User size={16} />}
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">{displayName}</div>
            <div className="text-xs text-muted-foreground">
              {isGroup ? '群聊' : '私聊'} · {new Date(binding.createdAt).toLocaleDateString('zh-CN')}
            </div>
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive">
              <Trash2 size={14} />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>解除绑定</AlertDialogTitle>
              <AlertDialogDescription>
                确定要解除「{displayName}」的飞书聊天绑定吗？解除后下次在飞书发消息会自动创建新绑定。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => onRemove(binding.chatId)}>
                确认解除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* 工作区选择 */}
      <div className="grid grid-cols-[80px_1fr] gap-2 items-center text-sm">
        <span className="text-muted-foreground">工作区</span>
        <Select
          value={binding.workspaceId}
          onValueChange={(value) => onUpdate(binding.chatId, { workspaceId: value })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="选择工作区">
              {currentWorkspace?.name ?? '未知工作区'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 会话显示 */}
        <span className="text-muted-foreground">会话</span>
        <Select
          value={binding.sessionId}
          onValueChange={(value) => onUpdate(binding.chatId, { sessionId: value })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="选择会话">
              {currentSession?.title ?? binding.sessionId.slice(0, 8)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {workspaceSessions.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

// ===== 绑定管理 Tab =====

function FeishuBindingsTab(): React.ReactElement {
  const bindings = useAtomValue(feishuBindingsAtom)
  const setBindings = useSetAtom(feishuBindingsAtom)
  const bridgeState = useAtomValue(feishuBridgeStateAtom)
  const [refreshing, setRefreshing] = React.useState(false)

  // 刷新绑定列表
  const refreshBindings = React.useCallback(async () => {
    setRefreshing(true)
    try {
      const list = await window.electronAPI.listFeishuBindings()
      setBindings(list)
    } catch {
      toast.error('获取绑定列表失败')
    } finally {
      setRefreshing(false)
    }
  }, [setBindings])

  // 进入 Tab 时自动刷新
  React.useEffect(() => {
    refreshBindings()
  }, [refreshBindings])

  // Bridge 状态变化时也刷新
  React.useEffect(() => {
    if (bridgeState.status === 'connected') {
      refreshBindings()
    }
  }, [bridgeState.status, refreshBindings])

  // 更新绑定
  const handleUpdate = React.useCallback(async (chatId: string, updates: { workspaceId?: string; sessionId?: string }) => {
    try {
      const result = await window.electronAPI.updateFeishuBinding({ chatId, ...updates })
      if (result) {
        setBindings((prev) => prev.map((b) => b.chatId === chatId ? result : b))
        toast.success('绑定已更新')
      }
    } catch {
      toast.error('更新绑定失败')
    }
  }, [setBindings])

  // 移除绑定
  const handleRemove = React.useCallback(async (chatId: string) => {
    try {
      const ok = await window.electronAPI.removeFeishuBinding(chatId)
      if (ok) {
        setBindings((prev) => prev.filter((b) => b.chatId !== chatId))
        toast.success('绑定已解除')
      }
    } catch {
      toast.error('解除绑定失败')
    }
  }, [setBindings])

  // 按类型分组：群聊 + 单聊
  const groupBindings = bindings.filter((b) => b.chatType === 'group')
  const p2pBindings = bindings.filter((b) => b.chatType !== 'group')

  return (
    <div className="space-y-8">
      <SettingsSection
        title="绑定管理"
        description="查看和管理飞书聊天与 Proma 工作区/会话的绑定关系"
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={refreshBindings}
            disabled={refreshing}
          >
            <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
            <span className="ml-1.5">刷新</span>
          </Button>
        }
      >
        {bindings.length === 0 ? (
          <SettingsCard divided={false}>
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              暂无活跃绑定。启动 Bridge 后在飞书中发消息即可自动创建绑定。
            </div>
          </SettingsCard>
        ) : (
          <div className="space-y-4">
            {/* 群聊绑定 */}
            {groupBindings.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  群聊 ({groupBindings.length})
                </div>
                <SettingsCard>
                  {groupBindings.map((binding) => (
                    <FeishuBindingCard
                      key={binding.chatId}
                      binding={binding}
                      onUpdate={handleUpdate}
                      onRemove={handleRemove}
                    />
                  ))}
                </SettingsCard>
              </div>
            )}

            {/* 单聊绑定 */}
            {p2pBindings.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  单聊 ({p2pBindings.length})
                </div>
                <SettingsCard>
                  {p2pBindings.map((binding) => (
                    <FeishuBindingCard
                      key={binding.chatId}
                      binding={binding}
                      onUpdate={handleUpdate}
                      onRemove={handleRemove}
                    />
                  ))}
                </SettingsCard>
              </div>
            )}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}

// ===== Bot 配置 Tab =====

function FeishuConfigTab(): React.ReactElement {
  const bridgeState = useAtomValue(feishuBridgeStateAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)

  // 表单状态
  const [appId, setAppId] = React.useState('')
  const [appSecret, setAppSecret] = React.useState('')
  const [defaultWorkspaceId, setDefaultWorkspaceId] = React.useState('')
  const [defaultNotifyMode, setDefaultNotifyMode] = React.useState('auto')

  // UI 状态
  const [loading, setLoading] = React.useState(true)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<FeishuTestResult | null>(null)

  // 加载配置
  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getFeishuConfig(),
      window.electronAPI.getDecryptedFeishuSecret().catch(() => ''),
    ]).then(([config, secret]) => {
      setAppId(config.appId ?? '')
      if (secret) setAppSecret(secret)
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

    try {
      await window.electronAPI.saveFeishuConfig({
        enabled: true,
        appId: appId.trim(),
        appSecret: appSecret || '',
        defaultWorkspaceId: defaultWorkspaceId || undefined,
      })
      toast.success('飞书配置已保存')
    } catch {
      toast.error('保存飞书配置失败')
    }
  }, [appId, appSecret, defaultWorkspaceId])

  // 保存默认配置
  const handleSaveDefaults = React.useCallback(async () => {
    try {
      await window.electronAPI.saveFeishuConfig({
        enabled: true,
        appId: appId.trim(),
        appSecret: '',
        defaultWorkspaceId: defaultWorkspaceId || undefined,
      })
      toast.success('默认配置已保存')
    } catch {
      toast.error('保存默认配置失败')
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
      toast.success('飞书 Bridge 已停止')
    } else {
      try {
        await window.electronAPI.startFeishuBridge()
        toast.success('飞书 Bridge 启动中...')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '启动飞书 Bridge 失败')
      }
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
            placeholder="输入 App Secret"
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
            disabled={!appId.trim()}
          >
            保存配置
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
              label="默认工作区（可在飞书内通过 /workspaces 选择）"
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
          >
            保存默认配置
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
            <PermissionsStep />

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
              <code className="text-foreground/80 font-mono">/now</code>
              <span>查看当前状态（工作区、会话、MCP、Skills）</span>
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

// ===== 主组件 =====

export function FeishuSettings(): React.ReactElement {
  const [activeTab, setActiveTab] = React.useState<FeishuTab>('config')

  return (
    <div className="space-y-6">
      {/* Tab 切换栏 */}
      <div className="inline-flex rounded-lg bg-muted p-1 gap-0.5">
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setActiveTab(tab.value)}
            className={cn(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              activeTab === tab.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      {activeTab === 'config' ? <FeishuConfigTab /> : <FeishuBindingsTab />}
    </div>
  )
}
