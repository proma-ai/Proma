import * as React from 'react'
import { useAtomValue } from 'jotai'
import { CheckCircle2, Copy, ExternalLink, Hash, Loader2, Plus, Power, PowerOff, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { SlackBotBridgeState, SlackBotSettingsConfig, SlackBridgeStatus, SlackTestResult } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { SettingsCard } from './primitives/SettingsCard'
import { SettingsInput } from './primitives/SettingsInput'
import { SettingsSecretInput } from './primitives/SettingsSecretInput'
import { SettingsSection } from './primitives/SettingsSection'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { copyTextToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { slackBotStatesAtom } from '@/atoms/slack-atoms'

const STATUS: Record<SlackBridgeStatus, { label: string; color: string }> = {
  disconnected: { label: '未连接', color: 'bg-muted-foreground/50' },
  connecting: { label: '连接中…', color: 'bg-amber-400 animate-pulse' },
  connected: { label: '已连接', color: 'bg-emerald-500' },
  error: { label: '连接错误', color: 'bg-red-500' },
}

function openLink(url: string): void {
  window.electronAPI.openExternal(url)
}

function Link({ href, children }: { href: string; children: React.ReactNode }): React.ReactElement {
  return <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline active:scale-[0.96] transition-transform" onClick={() => openLink(href)}>
    {children}<ExternalLink className="size-3" />
  </button>
}

export function SlackSettings(): React.ReactElement {
  const states = useAtomValue(slackBotStatesAtom)
  const [bots, setBots] = React.useState<SlackBotSettingsConfig[]>([])
  const [loading, setLoading] = React.useState(true)

  const reload = React.useCallback(async () => {
    try {
      setBots((await window.electronAPI.getSlackConfig()).bots)
    } catch (error) {
      console.error('[SlackSettings] 加载配置失败:', error)
      toast.error('无法加载 Slack 配置')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void reload() }, [reload])

  const addBot = React.useCallback(async () => {
    try {
      const saved = await window.electronAPI.saveSlackBotConfig({
        name: 'Proma',
        enabled: false,
        botToken: '',
        appToken: '',
      })
      setBots((previous) => [...previous, saved])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建 Slack Bot 失败')
    }
  }, [bots.length])

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>

  return <div className="space-y-8 antialiased">
    <SettingsSection
      title="Slack Bot"
      description="通过 Socket Mode 将本机 Proma 安全地接入 Slack，无需公网回调地址。"
      action={<Button size="sm" variant="outline" onClick={addBot} className="active:scale-[0.96] transition-transform"><Plus className="mr-1.5 size-4" />添加 Bot</Button>}
    >
      {bots.length === 0 ? <SettingsCard divided={false}>
        <div className="px-4 py-10 text-center">
          <Hash className="mx-auto mb-3 size-7 text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">尚未配置 Slack Bot</p>
          <p className="mt-1 text-xs text-muted-foreground">点击「添加 Bot」，复制 Manifest 到 Slack 后填入两枚 Token。</p>
        </div>
      </SettingsCard> : <div className="space-y-3">
        {bots.map((bot) => <SlackBotCard key={bot.id} bot={bot} state={states[bot.id]} onChanged={reload} />)}
      </div>}
    </SettingsSection>

    <SettingsSection title="按顺序连接 Slack" description="完整指南见 docs/slack-bridge.md；Token 只应粘贴到本机 Proma，不要发送到聊天或提交到 Git。">
      <SettingsCard divided={false}>
        <ol className="space-y-4 px-4 py-5 text-sm text-muted-foreground">
          <li className="flex gap-3"><Step n="1" /><span>先点击<strong className="font-medium text-foreground">添加 Bot</strong>，展开卡片后复制 Manifest。App 名称默认 <code className="rounded bg-muted px-1 py-0.5">Proma</code>，不能包含中文。</span></li>
          <li className="flex gap-3"><Step n="2" /><span>打开 <Link href="https://api.slack.com/apps">Slack API</Link>，选择 <strong className="font-medium text-foreground">Create New App → From an app manifest</strong>，选择目标 workspace、粘贴 Manifest；若出现 <strong className="font-medium text-foreground">Save Changes</strong>，请保存。</span></li>
          <li className="flex gap-3"><Step n="3" /><span>在 <strong className="font-medium text-foreground">Socket Mode</strong> 确认开关已开启。点 <strong className="font-medium text-foreground">App Level Token</strong> → <strong className="font-medium text-foreground">Generate Token and Scopes</strong>，添加 <code className="rounded bg-muted px-1 py-0.5">connections:write</code>，复制 <code className="rounded bg-muted px-1 py-0.5">xapp-…</code>。</span></li>
          <li className="flex gap-3"><Step n="4" /><span>在 <strong className="font-medium text-foreground">Install App</strong> 点击 <strong className="font-medium text-foreground">Install to Workspace</strong>，由有权限的成员确认 Slack 授权，复制生成的 <code className="rounded bg-muted px-1 py-0.5">xoxb-…</code>。</span></li>
          <li className="flex gap-3"><Step n="5" /><span>将 <code className="rounded bg-muted px-1 py-0.5">xoxb-…</code> 填入 Bot Token、<code className="rounded bg-muted px-1 py-0.5">xapp-…</code> 填入 App Token。<strong className="font-medium text-foreground">测试 Token</strong> 只验证 Bot API；点击<strong className="font-medium text-foreground">保存并连接</strong>，卡片显示“已连接”才表示 Socket Mode 就绪。</span></li>
          <li className="flex gap-3"><Step n="6" /><span>将 Bot 邀请进要使用的频道；任意成员都可用 <strong className="font-medium text-foreground">@Proma</strong> 发起任务，Proma 会始终在同一 thread 回复。此集成不接收 Slack 私信或 Slash Command。</span></li>
        </ol>
      </SettingsCard>
    </SettingsSection>
  </div>
}

function Step({ n }: { n: string }): React.ReactElement {
  return <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{n}</span>
}

function SlackBotCard({ bot, state, onChanged }: { bot: SlackBotSettingsConfig; state?: SlackBotBridgeState; onChanged: () => Promise<void> }): React.ReactElement {
  const [name, setName] = React.useState(bot.name)
  const [botToken, setBotToken] = React.useState('')
  const [appToken, setAppToken] = React.useState('')
  const [homeChannel, setHomeChannel] = React.useState(bot.homeChannelId ?? '')
  const [expanded, setExpanded] = React.useState(!bot.hasBotToken || !bot.hasAppToken)
  const [testing, setTesting] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [testResult, setTestResult] = React.useState<SlackTestResult | null>(null)
  const [manifestCopied, setManifestCopied] = React.useState(false)

  const status = STATUS[state?.status ?? 'disconnected']
  const connected = state?.status === 'connected' || state?.status === 'connecting'
  const hasBotToken = Boolean(bot.hasBotToken || botToken.trim())
  const hasAppToken = Boolean(bot.hasAppToken || appToken.trim())

  const copyManifest = React.useCallback(async () => {
    const { json } = await window.electronAPI.getSlackManifest({ botName: name.trim() || 'Proma' })
    await copyTextToClipboard(json)
    setManifestCopied(true)
    window.setTimeout(() => setManifestCopied(false), 1600)
    toast.success('Slack App Manifest 已复制')
  }, [name])

  const save = React.useCallback(async () => {
    if (!name.trim() || !hasBotToken || !hasAppToken) {
      toast.error('请填写 App 名称、Bot Token 与 App Token')
      return
    }
    setSaving(true)
    try {
      await window.electronAPI.saveSlackBotConfig({
        id: bot.id,
        name: name.trim(),
        enabled: true,
        botToken: botToken.trim(),
        appToken: appToken.trim(),
        homeChannelId: homeChannel.trim() || undefined,
      })
      await onChanged()
      toast.success('Slack Bot 已保存，正在连接 Socket Mode')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 Slack 配置失败')
    } finally {
      setSaving(false)
    }
  }, [appToken, bot.id, botToken, hasAppToken, hasBotToken, homeChannel, name, onChanged])

  const test = React.useCallback(async () => {
    setTesting(true); setTestResult(null)
    try { setTestResult(await window.electronAPI.testSlackConnection(botToken.trim())) }
    catch (error) { setTestResult({ success: false, message: error instanceof Error ? error.message : 'Slack 连接测试失败' }) }
    finally { setTesting(false) }
  }, [botToken])

  const toggle = React.useCallback(async () => {
    try {
      if (connected) await window.electronAPI.stopSlackBot(bot.id)
      else await window.electronAPI.startSlackBot(bot.id)
    } catch (error) { toast.error(error instanceof Error ? error.message : '切换连接失败') }
  }, [bot.id, connected])

  const remove = React.useCallback(async () => {
    await window.electronAPI.removeSlackBot(bot.id)
    await onChanged()
    toast.success('Slack Bot 已删除')
  }, [bot.id, onChanged])

  const detailsId = `slack-bot-details-${bot.id}`

  return <SettingsCard>
    <div className="flex min-h-12 items-center px-4 py-3">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className={cn('size-2 shrink-0 rounded-full', status.color)} />
          <span className="truncate text-sm font-medium">{bot.name || 'Proma'}</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">{status.label}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{expanded ? '收起' : '配置'}</span>
      </button>
      {bot.hasBotToken && <Button type="button" size="sm" variant="outline" onClick={() => void toggle()} className="ml-3 min-h-9 shrink-0 active:scale-[0.96] transition-transform">
        {connected ? <><PowerOff className="mr-1 size-3.5" />停止</> : <><Power className="mr-1 size-3.5" />启动</>}
      </Button>}
    </div>
    {expanded && <div id={detailsId} className="space-y-4 border-t border-border/60 px-4 pb-5 pt-4">
      <SettingsInput label="App 名称" description="默认 Proma，用于生成 Slack App Manifest；不能包含中文。" value={name} onChange={setName} placeholder="Proma" />
      <div className="grid gap-4 md:grid-cols-2"><SettingsSecretInput label="Bot Token" value={botToken} onChange={setBotToken} placeholder={bot.hasBotToken ? '已保存；留空保留，粘贴以替换' : 'xoxb-…'} /><SettingsSecretInput label="App Token" value={appToken} onChange={setAppToken} placeholder={bot.hasAppToken ? '已保存；留空保留，粘贴以替换' : 'xapp-…'} /></div>
      {(bot.hasBotToken || bot.hasAppToken) && <p className="-mt-2 text-xs text-muted-foreground">已保存的 Token 不会回显到页面；留空会保留原凭证，重新粘贴可替换。</p>}
      <div className="rounded-lg bg-muted/45 px-3 py-2.5 text-sm"><p className="font-medium">频道访问已开放</p><p className="mt-0.5 text-xs text-muted-foreground">工作区任意成员都可在 Bot 已加入的任意频道通过 <code>@{bot.name || 'Proma'}</code> 发起任务，并在自己发起的 thread 中处理计划与单次权限确认；仍只响应 @mention。</p></div>
      <SettingsInput label="Home Channel ID（可选）" description="可填一个 Bot 已加入的频道 ID。Proma 在桌面端、Automation 或其他 Bridge 完成任务时会在此发送仅含标题与状态的完成通知；标题仍会对该频道成员可见。Slack 自己发起的任务仍只在原 thread 回复。留空不会影响正常使用。" value={homeChannel} onChange={setHomeChannel} placeholder="例如 C012…" />
      <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant="outline" onClick={() => void copyManifest()} className="min-h-9 active:scale-[0.96] transition-transform">{manifestCopied ? <CheckCircle2 className="mr-1 size-3.5" /> : <Copy className="mr-1 size-3.5" />}{manifestCopied ? '已复制 Manifest' : '复制 Manifest'}</Button><Button type="button" size="sm" variant="outline" disabled={testing || !botToken.trim()} onClick={() => void test()} className="min-h-9 active:scale-[0.96] transition-transform">{testing && <Loader2 className="mr-1 size-3.5 animate-spin" />}测试 Token</Button><Button type="button" size="sm" disabled={saving} onClick={() => void save()} className="min-h-9 active:scale-[0.96] transition-transform">{saving && <Loader2 className="mr-1 size-3.5 animate-spin" />}保存并连接</Button><AlertDialog><AlertDialogTrigger asChild><Button type="button" size="sm" variant="destructive" className="min-h-9 active:scale-[0.96] transition-transform"><Trash2 className="mr-1 size-3.5" />删除</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除 Slack Bot？</AlertDialogTitle><AlertDialogDescription>这会断开本机 Socket Mode 连接并删除已保存的 Token 配置。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void remove()}>删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>
      {testResult && <div className={cn('flex items-start gap-2 rounded-lg p-3 text-sm', testResult.success ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-700 dark:text-red-300')}>
        {testResult.success ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}<span>{testResult.message}</span>
      </div>}
      {state?.errorMessage && <p className="text-xs text-red-500">{state.errorMessage}</p>}
    </div>}
  </SettingsCard>
}
