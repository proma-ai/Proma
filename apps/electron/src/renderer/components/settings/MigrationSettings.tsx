import * as React from 'react'
import { Copy, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { SettingsSection } from './primitives'
import { copyTextToClipboard } from '@/lib/clipboard'

const ARCHIVE_MIGRATION_PROMPT = `请帮我创建一个可迁移的 Proma 数据压缩包。

Proma 的本地数据通常存放在 ~/.proma。请按以下步骤处理：

1. 先确认当前 Proma 数据文件夹的位置、计划生成的 ZIP 路径，以及压缩包是否可能包含会话记录、工作区配置和本地文件。
2. 在开始压缩前向我展示范围并征得确认；不要删除、移动或修改原始数据文件夹。
3. 将完整的 .proma 数据文件夹压缩为一个 ZIP 文件，并告诉我生成路径和文件大小。
4. 提醒我将 ZIP 通过可信方式传输到新设备，并在新设备的 Proma 对话中附上该 ZIP，执行恢复、项目路径分配和索引重建。
5. 不要尝试导出系统钥匙串、OAuth 登录或其他系统级凭据；这些内容需要在新设备上重新登录或配置。`

const RESTORE_MIGRATION_PROMPT = `我正在恢复来自另一台设备的 Proma 数据，并已附上旧设备 .proma 文件夹的 ZIP 压缩包。

请按以下步骤处理：

1. 先检查 ZIP 的内容，并说明将要写入的此设备 Proma 数据目录以及可能覆盖的文件；在任何覆盖前征得我的确认，并为现有数据创建可恢复备份。
2. 将压缩包解压到此设备的 Proma 数据目录，按当前版本的数据结构完成必要迁移。
3. 为每个恢复的工作区核对对应的本地项目目录；旧设备路径不可用时，询问我如何重新分配或跳过。
4. 重建会话、工作区和本地文件索引，检查恢复的数据是否能正常读取。
5. 完成后说明恢复的会话、工作区和需要重新绑定的本地项目；不要尝试恢复系统钥匙串、API Key 或 OAuth 登录，缺失的凭据请提示我重新配置。`

export function MigrationSettings(): React.ReactElement {
  const handleOpenDataFolder = async (): Promise<void> => {
    try {
      await window.electronAPI.openMigrationDataFolder()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法打开数据文件夹')
    }
  }

  const handleCopyPrompt = (prompt: string, successMessage: string): void => {
    void copyTextToClipboard(prompt).then(
      () => toast.success(successMessage),
      () => toast.error('复制失败，请手动复制提示词'),
    )
  }

  const handleCopyArchivePrompt = (): void => {
    handleCopyPrompt(ARCHIVE_MIGRATION_PROMPT, '创建压缩包提示词已复制到剪贴板')
  }

  const handleCopyRestorePrompt = (): void => {
    handleCopyPrompt(RESTORE_MIGRATION_PROMPT, '恢复数据提示词已复制到剪贴板')
  }

  return (
    <div className="space-y-8">
      <SettingsSection
        title="迁移原理"
        description="Proma 的本地数据通常存放在 .proma 文件夹。迁移时先压缩该文件夹，再在新设备上由 Proma 解压、分配项目路径并重建索引。"
      >
        <ol className="space-y-3 text-sm leading-6 text-muted-foreground">
          <li className="flex gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">1</span>
            <span>在当前设备将完整的 .proma 数据文件夹压缩为 ZIP，原始数据保持不变。</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">2</span>
            <span>将 ZIP 通过可信方式传输到新设备，并附到任意一个 Proma 对话中。</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">3</span>
            <span>新设备上的 Proma 解压数据、重新分配本地项目目录，并重建会话、工作区和文件索引。</span>
          </li>
        </ol>
      </SettingsSection>

      <SettingsSection
        title="当前设备：创建迁移压缩包"
        description="先打开 Proma 数据文件夹；随后可将提示词粘贴到任意 Proma 对话，由 Agent 协助创建 ZIP。"
      >
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void handleOpenDataFolder()}
            className="flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.96]"
          >
            <FolderOpen size={16} />
            打开数据文件夹
          </button>
          <button
            onClick={handleCopyArchivePrompt}
            className="flex min-h-10 items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 active:scale-[0.96]"
          >
            <Copy size={16} />
            复制创建压缩包提示词
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="新设备：恢复 Proma 数据"
        description="在新设备的任意 Proma 对话中附上 ZIP，再粘贴以下提示词完成解压、项目分配和索引重建。"
      >
        <div className="relative rounded-lg border border-border/60 bg-muted/30 p-4 pr-14">
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-muted-foreground">{RESTORE_MIGRATION_PROMPT}</pre>
          <button
            aria-label="复制恢复数据提示词"
            title="复制恢复数据提示词"
            onClick={handleCopyRestorePrompt}
            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground active:scale-[0.96]"
          >
            <Copy size={16} />
          </button>
        </div>
      </SettingsSection>

      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-800 dark:text-amber-200">
        数据文件夹可能包含会话记录、文件和配置。请仅通过可信渠道传输并妥善保管压缩包。系统钥匙串中的 API Key 和登录凭据不会随文件夹复制，迁移后可能需要重新登录或配置。
      </div>
    </div>
  )
}
