/**
 * ApiKeysSettings - API Key 管理设置页
 *
 * Cloud 模式专属功能，管理用户的 API Keys：
 * - 创建 / 删除 / 启用 / 禁用 API Key
 * - 查看使用统计（请求次数、消耗金额）
 * - API 使用说明（可折叠）
 */

import * as React from 'react'
import {
  Plus,
  Key,
  Trash2,
  Copy,
  Check,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Pencil,
  Eye,
  EyeOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { SettingsSection, SettingsCard } from './primitives'
import type { ApiKeyResponse, ApiKeyStatus } from '@proma/shared'

// ===== 工具函数 =====

/** 格式化日期 */
function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 格式化费用（积分） */
function formatCost(cost: number | string): string {
  const num = typeof cost === 'string' ? parseFloat(cost) : cost
  return `${num.toFixed(4)} 积分`
}

/** 格式化 API Key 显示（只显示前缀和后4位） */
function formatKeyDisplay(key: string): string {
  if (key.length <= 12) return key
  return `${key.slice(0, 7)}...${key.slice(-4)}`
}

/** 安全地将 number | string 转为数字 */
function toNum(val: number | string | null | undefined): number {
  if (val == null) return 0
  return typeof val === 'string' ? parseFloat(val) : val
}

/** 格式化限额显示 */
function formatQuota(apiKey: ApiKeyResponse): string {
  if (apiKey.quotaLimit == null) return '不限制'
  const remaining = Math.max(0, toNum(apiKey.quotaLimit) - toNum(apiKey.totalCost))
  if (remaining <= 0) return '已用完'
  return `剩余 ${remaining.toFixed(2)} 积分`
}

// ===== 子组件 =====

/** 状态 Badge */
function StatusBadge({ status }: { status: ApiKeyStatus }): React.ReactElement {
  switch (status) {
    case 'ACTIVE':
      return (
        <Badge variant="outline" className="gap-1 border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          启用
        </Badge>
      )
    case 'DISABLED':
      return <Badge variant="secondary">禁用</Badge>
    case 'EXPIRED':
      return <Badge variant="destructive">已过期</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

/** 创建 API Key 对话框 */
function CreateApiKeyDialog({ onCreated }: { onCreated: () => void }): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [quotaMode, setQuotaMode] = React.useState<'unlimited' | 'custom'>('unlimited')
  const [quotaValue, setQuotaValue] = React.useState('')
  const [createdKey, setCreatedKey] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [showKey, setShowKey] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleCreate = async (): Promise<void> => {
    if (!name.trim()) return
    if (quotaMode === 'custom' && (!quotaValue || parseFloat(quotaValue) <= 0)) {
      setError('请输入有效的初始额度')
      return
    }

    setCreating(true)
    setError(null)

    try {
      const response = await window.electronAPI.cloudApiKeys.create({
        name: name.trim(),
        description: description.trim() || undefined,
        quotaLimit: quotaMode === 'custom' ? parseFloat(quotaValue) : undefined,
      })

      if (response.success && response.data) {
        setCreatedKey(response.data.key)
        onCreated()
      } else {
        setError(response.error || '创建失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }

  const handleCopy = async (): Promise<void> => {
    if (!createdKey) return
    try {
      await navigator.clipboard.writeText(createdKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 复制失败静默处理
    }
  }

  const handleClose = (): void => {
    setOpen(false)
    setTimeout(() => {
      setName('')
      setDescription('')
      setQuotaMode('unlimited')
      setQuotaValue('')
      setCreatedKey(null)
      setCopied(false)
      setShowKey(false)
      setError(null)
    }, 200)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus size={16} />
          <span>创建 API Key</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {createdKey ? 'API Key 已创建' : '创建 API Key'}
          </DialogTitle>
          <DialogDescription>
            {createdKey
              ? '通过此 API KEY 可以访问任何 Proma API 支持的大模型服务，包含 OpenAI/Anthropic 等格式。'
              : '创建一个新的 API Key 用于访问 Proma API。'}
          </DialogDescription>
        </DialogHeader>

        {createdKey ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
              <code className="flex-1 break-all font-mono text-sm">
                {showKey ? createdKey : 'sk-' + '\u2022'.repeat(40)}
              </code>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleCopy}
              >
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>请务必妥善保管好你的 API KEY，通过此 API KEY 会直接消费你的 Proma 余额。</span>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-key-name">名称 *</Label>
              <Input
                id="api-key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：生产环境、测试环境"
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key-desc">描述（可选）</Label>
              <Input
                id="api-key-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="用于描述此 API Key 的用途"
              />
            </div>
            <div className="space-y-2">
              <Label>用量限额</Label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="create-quota-mode"
                    checked={quotaMode === 'unlimited'}
                    onChange={() => setQuotaMode('unlimited')}
                    className="accent-primary"
                  />
                  不限制
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="create-quota-mode"
                    checked={quotaMode === 'custom'}
                    onChange={() => setQuotaMode('custom')}
                    className="accent-primary"
                  />
                  设置初始额度
                </label>
              </div>
              {quotaMode === 'custom' && (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={quotaValue}
                    onChange={(e) => setQuotaValue(e.target.value)}
                    placeholder="输入积分数"
                    className="w-40"
                  />
                  <span className="text-sm text-muted-foreground">积分</span>
                </div>
              )}
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
        )}

        <DialogFooter>
          {createdKey ? (
            <Button onClick={handleClose}>完成</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button
                onClick={handleCreate}
                disabled={creating || !name.trim()}
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    创建中...
                  </>
                ) : (
                  '创建'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 编辑 API Key 对话框 */
function EditApiKeyDialog({
  apiKey,
  open,
  onClose,
  onSaved,
}: {
  apiKey: ApiKeyResponse
  open: boolean
  onClose: () => void
  onSaved: () => void
}): React.ReactElement {
  const [name, setName] = React.useState(apiKey.name)
  const [description, setDescription] = React.useState(apiKey.description ?? '')
  const [quotaMode, setQuotaMode] = React.useState<'unlimited' | 'custom'>(
    apiKey.quotaLimit != null ? 'custom' : 'unlimited',
  )
  const [adjustAmount, setAdjustAmount] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Reset form when dialog opens with new key
  React.useEffect(() => {
    if (open) {
      setName(apiKey.name)
      setDescription(apiKey.description ?? '')
      setQuotaMode(apiKey.quotaLimit != null ? 'custom' : 'unlimited')
      setAdjustAmount('')
      setError(null)
    }
  }, [open, apiKey])

  const currentQuotaLimit = toNum(apiKey.quotaLimit)
  const currentTotalCost = toNum(apiKey.totalCost)
  const currentRemaining = Math.max(0, currentQuotaLimit - currentTotalCost)

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) {
      setError('名称不能为空')
      return
    }

    setSaving(true)
    setError(null)

    try {
      let newQuotaLimit: number | null | undefined

      if (quotaMode === 'unlimited') {
        // Switch to unlimited
        newQuotaLimit = null
      } else if (apiKey.quotaLimit == null) {
        // Switching from unlimited to custom — need initial amount
        const amount = parseFloat(adjustAmount)
        if (!adjustAmount || isNaN(amount) || amount <= 0) {
          setError('请输入有效的初始额度')
          setSaving(false)
          return
        }
        // New quotaLimit = totalCost + initial amount (so remaining = amount)
        newQuotaLimit = currentTotalCost + amount
      } else if (adjustAmount && parseFloat(adjustAmount) !== 0) {
        // Adjusting existing quota
        const amount = parseFloat(adjustAmount)
        if (isNaN(amount)) {
          setError('请输入有效的数字')
          setSaving(false)
          return
        }
        const newLimit = currentQuotaLimit + amount
        if (newLimit < currentTotalCost) {
          setError(`不能减少超过剩余额度（当前剩余 ${currentRemaining.toFixed(2)} 积分）`)
          setSaving(false)
          return
        }
        newQuotaLimit = newLimit
      }

      const params: Partial<import('@proma/shared').ApiKeyUpdateParams> = {}
      if (name.trim() !== apiKey.name) params.name = name.trim()
      if (description.trim() !== (apiKey.description ?? '')) {
        params.description = description.trim() || undefined
      }
      if (newQuotaLimit !== undefined) params.quotaLimit = newQuotaLimit

      if (Object.keys(params).length === 0) {
        onClose()
        return
      }

      await window.electronAPI.cloudApiKeys.update(apiKey.id, params)
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑 API Key</DialogTitle>
          <DialogDescription>修改名称、描述或用量限额</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">名称</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="API Key 名称"
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-desc">描述</Label>
            <Input
              id="edit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="用于描述此 API Key 的用途"
            />
          </div>

          <div className="space-y-2">
            <Label>用量限额</Label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="edit-quota-mode"
                  checked={quotaMode === 'unlimited'}
                  onChange={() => setQuotaMode('unlimited')}
                  className="accent-primary"
                />
                不限制
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="edit-quota-mode"
                  checked={quotaMode === 'custom'}
                  onChange={() => setQuotaMode('custom')}
                  className="accent-primary"
                />
                自定义限额
              </label>
            </div>

            {quotaMode === 'custom' && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                {apiKey.quotaLimit != null ? (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">当前剩余</span>
                      <span className="font-medium">{currentRemaining.toFixed(2)} 积分</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="1"
                        value={adjustAmount}
                        onChange={(e) => setAdjustAmount(e.target.value)}
                        placeholder="输入调整数量（正数增加，负数减少）"
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground shrink-0">积分</span>
                    </div>
                    {adjustAmount && !isNaN(parseFloat(adjustAmount)) && (
                      <p className="text-xs text-muted-foreground">
                        调整后剩余：{Math.max(0, currentRemaining + parseFloat(adjustAmount)).toFixed(2)} 积分
                      </p>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={adjustAmount}
                      onChange={(e) => setAdjustAmount(e.target.value)}
                      placeholder="输入初始额度"
                      className="w-40"
                    />
                    <span className="text-sm text-muted-foreground">积分</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                保存中...
              </>
            ) : (
              '保存'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** API Key 表格行 */
function ApiKeyRow({
  apiKey,
  onRefresh,
}: {
  apiKey: ApiKeyResponse
  onRefresh: () => void
}): React.ReactElement {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [editDialogOpen, setEditDialogOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [toggling, setToggling] = React.useState(false)

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(apiKey.key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 复制失败静默处理
    }
  }

  const handleDelete = async (): Promise<void> => {
    setDeleting(true)
    try {
      await window.electronAPI.cloudApiKeys.delete(apiKey.id)
      setDeleteDialogOpen(false)
      onRefresh()
    } catch {
      // 删除失败静默处理
    } finally {
      setDeleting(false)
    }
  }

  const handleToggleStatus = async (): Promise<void> => {
    const newStatus = apiKey.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
    setToggling(true)
    try {
      await window.electronAPI.cloudApiKeys.update(apiKey.id, { status: newStatus })
      onRefresh()
    } catch {
      // 更新失败静默处理
    } finally {
      setToggling(false)
    }
  }

  return (
    <>
      <TableRow>
        <TableCell>
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="font-medium truncate">{apiKey.name}</p>
              {apiKey.description && (
                <p className="text-xs text-muted-foreground truncate">
                  {apiKey.description}
                </p>
              )}
            </div>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {formatKeyDisplay(apiKey.key)}
            </code>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleCopy}
                >
                  {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{copied ? '已复制' : '复制'}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TableCell>
        <TableCell>
          <StatusBadge status={apiKey.status} />
        </TableCell>
        <TableCell className="text-muted-foreground">
          {apiKey.requestCount.toLocaleString()}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {formatCost(apiKey.totalCost)}
        </TableCell>
        <TableCell className="text-muted-foreground text-sm">
          {formatQuota(apiKey)}
        </TableCell>
        <TableCell className="text-muted-foreground text-sm">
          {formatDate(apiKey.lastUsedAt)}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setEditDialogOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>编辑</p>
              </TooltipContent>
            </Tooltip>
            <Switch
              checked={apiKey.status === 'ACTIVE'}
              onCheckedChange={handleToggleStatus}
              disabled={toggling}
              className="scale-75"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setDeleteDialogOpen(true)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>删除</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TableCell>
      </TableRow>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 API Key &ldquo;{apiKey.name}&rdquo; 吗？此操作不可撤销，所有使用此 Key 的应用将无法访问 API。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  删除中...
                </>
              ) : (
                '删除'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EditApiKeyDialog
        apiKey={apiKey}
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        onSaved={onRefresh}
      />
    </>
  )
}

/** API 使用说明（可折叠） */
function ApiUsageGuide(): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)

  return (
    <SettingsCard>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">API 使用说明</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              使用 API Key 可以通过 HTTP 请求访问 Proma API，兼容 OpenAI/Anthropic 格式。
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="shrink-0"
          >
            {expanded ? (
              <>
                收起
                <ChevronUp className="ml-1 h-4 w-4" />
              </>
            ) : (
              <>
                展开
                <ChevronDown className="ml-1 h-4 w-4" />
              </>
            )}
          </Button>
        </div>

        <div className="mt-3 space-y-3">
          {/* 默认显示 - OpenAI 格式 */}
          <div className="rounded-lg bg-muted p-3">
            <p className="mb-1.5 text-xs font-medium">OpenAI 兼容格式</p>
            <pre className="overflow-x-auto text-xs text-muted-foreground">
{expanded
  ? `curl https://api.proma.cool/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`
  : `curl https://api.proma.cool/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{ "model": "claude-sonnet-4-6", ... }'`}
            </pre>
          </div>

          {/* 展开后显示 */}
          {expanded && (
            <>
              <div className="rounded-lg bg-muted p-3">
                <p className="mb-1.5 text-xs font-medium">Anthropic 兼容格式</p>
                <pre className="overflow-x-auto text-xs text-muted-foreground">
{`curl https://api.proma.cool/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: YOUR_API_KEY" \\
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}
                </pre>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <p className="mb-1.5 text-xs font-medium">获取模型列表</p>
                <pre className="overflow-x-auto text-xs text-muted-foreground">
{`curl https://api.proma.cool/v1/models`}
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}

// ===== 主组件 =====

export function ApiKeysSettings(): React.ReactElement {
  const [apiKeys, setApiKeys] = React.useState<ApiKeyResponse[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const loadApiKeys = React.useCallback(async () => {
    try {
      const response = await window.electronAPI.cloudApiKeys.list()
      if (response.success && response.data) {
        setApiKeys(response.data)
        setError(null)
      } else {
        setError(response.error || '加载失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadApiKeys()
  }, [loadApiKeys])

  return (
    <div className="space-y-8">
      {/* API 使用说明 */}
      <SettingsSection
        title="API"
        description="管理您的 API 密钥，用于访问 Proma API"
      >
        <ApiUsageGuide />
      </SettingsSection>

      {/* API Keys 列表 */}
      <SettingsSection
        title="API Keys"
        description="您创建的所有 API Keys"
        action={<CreateApiKeyDialog onCreated={loadApiKeys} />}
      >
        <SettingsCard divided={false}>
          {loading ? (
            <div className="py-8 text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">加载中...</p>
            </div>
          ) : error ? (
            <div className="py-8 text-center text-destructive text-sm">
              {error}
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="py-12 text-center">
              <Key className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">还没有 API Keys</p>
              <p className="text-xs text-muted-foreground mt-1">
                点击上方按钮创建您的第一个 API Key
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>请求次数</TableHead>
                  <TableHead>消耗金额</TableHead>
                  <TableHead>限额</TableHead>
                  <TableHead>最后使用</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((apiKey) => (
                  <ApiKeyRow
                    key={apiKey.id}
                    apiKey={apiKey}
                    onRefresh={loadApiKeys}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
