/**
 * 快捷键默认配置
 *
 * 定义所有快捷键的 ID、名称、描述、默认绑定和分类。
 * 这是快捷键系统的基础数据层，由 shortcut-registry 消费。
 */

// ===== 类型定义 =====

/** 快捷键分类 */
export type ShortcutCategory = 'app' | 'edit' | 'navigation' | 'global'

/** 快捷键定义（不可变，内置于代码） */
export interface ShortcutDefinition {
  /** 唯一标识（如 'open-settings'） */
  id: string
  /** 中文名称 */
  name: string
  /** 中文描述 */
  description: string
  /** macOS 默认快捷键（如 'Cmd+,'） */
  defaultMac: string
  /** Windows 默认快捷键（如 'Ctrl+,'） */
  defaultWin: string
  /** 分类 */
  category: ShortcutCategory
  /** 是否为全局快捷键（由主进程 globalShortcut 注册） */
  global?: boolean
}

/** 用户自定义快捷键覆盖（持久化到 settings.json） */
export interface ShortcutOverrides {
  [shortcutId: string]: {
    mac?: string
    win?: string
  }
}

// ===== 分类标签 =====

export const SHORTCUT_CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  app: '应用',
  edit: '编辑',
  navigation: '导航',
  global: '全局',
}

// ===== 默认快捷键列表 =====

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // 应用级
  {
    id: 'open-settings',
    name: '打开设置',
    description: '打开应用设置面板',
    defaultMac: 'Cmd+,',
    defaultWin: 'Ctrl+,',
    category: 'app',
  },
  {
    id: 'new-session',
    name: '新建对话',
    description: '根据当前模式创建 Chat 对话或 Agent 会话',
    defaultMac: 'Cmd+N',
    defaultWin: 'Ctrl+N',
    category: 'app',
  },
  {
    id: 'toggle-sidebar',
    name: '切换侧边栏',
    description: '显示或隐藏左侧边栏',
    defaultMac: 'Cmd+B',
    defaultWin: 'Ctrl+B',
    category: 'app',
  },
  {
    id: 'toggle-mode',
    name: '切换模式',
    description: '在 Chat 和 Agent 模式之间切换',
    defaultMac: 'Cmd+Shift+M',
    defaultWin: 'Ctrl+Shift+M',
    category: 'app',
  },
  {
    id: 'global-search',
    name: '全局搜索',
    description: '搜索对话和会话',
    defaultMac: 'Cmd+F',
    defaultWin: 'Ctrl+F',
    category: 'navigation',
  },
  {
    id: 'focus-input',
    name: '聚焦输入框',
    description: '快速跳转到输入框',
    defaultMac: 'Cmd+L',
    defaultWin: 'Ctrl+L',
    category: 'navigation',
  },

  // 编辑级
  {
    id: 'clear-context',
    name: '清除上下文',
    description: '清除当前对话的上下文',
    defaultMac: 'Cmd+K',
    defaultWin: 'Ctrl+K',
    category: 'edit',
  },
  {
    id: 'stop-generation',
    name: '停止生成',
    description: '中断当前 AI 响应',
    defaultMac: 'Cmd+.',
    defaultWin: 'Ctrl+.',
    category: 'edit',
  },
  {
    id: 'close-tab',
    name: '关闭当前标签',
    description: '关闭当前活跃的 Chat 或 Agent 标签页',
    defaultMac: 'Cmd+W',
    defaultWin: 'Ctrl+W',
    category: 'app',
  },

  // 全局快捷键（由主进程 globalShortcut 注册，应用外也生效）
  {
    id: 'quick-task',
    name: '快速任务',
    description: '唤起浮动快速任务输入窗口',
    defaultMac: 'Alt+Space',
    defaultWin: 'Alt+Space',
    category: 'global',
    global: true,
  },
  {
    id: 'show-main-window',
    name: '显示主窗口',
    description: '显示并聚焦 Proma 主窗口',
    defaultMac: 'Cmd+Shift+P',
    defaultWin: 'Ctrl+Shift+P',
    category: 'global',
    global: true,
  },
]

/** 按 ID 索引的快捷键 Map（用于快速查找） */
export const SHORTCUT_MAP = new Map(
  DEFAULT_SHORTCUTS.map((s) => [s.id, s]),
)
