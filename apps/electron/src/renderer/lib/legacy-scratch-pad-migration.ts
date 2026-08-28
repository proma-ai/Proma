/**
 * 保留旧 Scratch Pad 数据迁移的无 UI 触发入口。
 * loadScratchPad IPC 在主进程中调用 getScratchPadPath，因此会将旧文件迁入默认 Vault。
 */
export function triggerLegacyScratchPadMigration(loadScratchPad: () => Promise<unknown>): void {
  void loadScratchPad()
    .catch((error) => console.error('[ScratchPad] 旧文件迁移触发失败:', error))
}
