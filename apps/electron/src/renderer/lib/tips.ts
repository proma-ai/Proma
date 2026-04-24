/**
 * Tips 管理模块 — 平台感知的使用技巧
 *
 * 区分 macOS / Windows 平台，提供随机轮换的小贴士。
 * Tips 内容可后续手动扩充。
 */

export type Platform = 'mac' | 'windows'

export interface Tip {
  id: string
  text: string
  /** 适用平台，'all' 表示通用 */
  platform: Platform | 'all'
}

/** 检测当前平台 */
export function getPlatform(): Platform {
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')) {
    return 'mac'
  }
  return 'windows'
}

/** 所有 Tips 数据 */
export const TIPS: Tip[] = [
  // macOS 快捷键
  { id: 'mac-shortcut-new', text: '按 ⌘N 快速创建新对话', platform: 'mac' },
  { id: 'mac-shortcut-search', text: '按 ⌘F 搜索历史对话', platform: 'mac' },
  { id: 'mac-shortcut-settings', text: '按 ⌘, 打开设置', platform: 'mac' },
  { id: 'mac-shortcut-sidebar', text: '按 ⌘B 切换侧边栏显示', platform: 'mac' },
  { id: 'mac-shortcut-mode', text: '按 ⌘⇧M 快速切换 Chat / Agent 模式', platform: 'mac' },
  { id: 'mac-shortcut-focus', text: '按 ⌘L 快速跳转到输入框', platform: 'mac' },
  { id: 'mac-shortcut-clear', text: '按 ⌘K 清除当前对话上下文', platform: 'mac' },
  { id: 'mac-shortcut-stop', text: '按 ⌘. 中断 AI 响应', platform: 'mac' },
  { id: 'mac-shortcut-close', text: '按 ⌘W 关闭当前标签页', platform: 'mac' },
  { id: 'mac-shortcut-zoom', text: '按 ⌘+ / ⌘- 可以放大或缩小界面，⌘0 重置', platform: 'mac' },
  { id: 'mac-shortcut-tab-switch', text: '按 Ctrl+Tab 快速切换标签，长按 Ctrl 反复按 Tab 可在标签间循环选择', platform: 'mac' },

  // Windows 快捷键
  { id: 'win-shortcut-new', text: '按 Ctrl+N 快速创建新对话', platform: 'windows' },
  { id: 'win-shortcut-search', text: '按 Ctrl+F 搜索历史对话', platform: 'windows' },
  { id: 'win-shortcut-settings', text: '按 Ctrl+, 打开设置', platform: 'windows' },
  { id: 'win-shortcut-sidebar', text: '按 Ctrl+B 切换侧边栏显示', platform: 'windows' },
  { id: 'win-shortcut-mode', text: '按 Ctrl+Shift+M 快速切换 Chat / Agent 模式', platform: 'windows' },
  { id: 'win-shortcut-focus', text: '按 Ctrl+L 快速跳转到输入框', platform: 'windows' },
  { id: 'win-shortcut-clear', text: '按 Ctrl+K 清除当前对话上下文', platform: 'windows' },
  { id: 'win-shortcut-stop', text: '按 Ctrl+Shift+Backspace 中断 AI 响应', platform: 'windows' },
  { id: 'win-shortcut-close', text: '按 Ctrl+W 关闭当前标签页', platform: 'windows' },
  { id: 'win-shortcut-zoom', text: '按 Ctrl++ / Ctrl+- 可以放大或缩小界面，Ctrl+0 重置', platform: 'windows' },
  { id: 'win-shortcut-tab-switch', text: '按 Ctrl+Tab 快速切换标签，长按 Ctrl 反复按 Tab 可在标签间循环选择', platform: 'windows' },

  // 通用
  { id: 'tip-agent-file', text: 'Agent 模式下输入 @ 可以引用工作区文件', platform: 'all' },
  { id: 'tip-agent-mcp', text: 'Agent 模式下输入 # 可以调用 MCP 工具', platform: 'all' },
  { id: 'tip-agent-skill', text: 'Agent 模式下输入 / 可以使用 Skill', platform: 'all' },
  { id: 'tip-attachment', text: '支持拖拽文件到输入框直接上传附件', platform: 'all' },
  { id: 'tip-shortcuts-custom', text: '在设置 → 快捷键中可以自定义所有快捷键', platform: 'all' },
]

/** 获取适用于当前平台的随机 Tip */
export function getRandomTip(platform: Platform): Tip {
  const filtered = TIPS.filter((t) => t.platform === 'all' || t.platform === platform)
  const index = Math.floor(Math.random() * filtered.length)
  return filtered[index] ?? filtered[0]!
}
