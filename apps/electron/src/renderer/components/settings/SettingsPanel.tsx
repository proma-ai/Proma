/**
 * SettingsPanel - 设置面板
 *
 * 顶部 Header（标题 + 关闭按钮）+ 下方（左侧导航 + 右侧 ScrollArea 内容区域）。
 * 使用 Jotai atom 管理当前标签页状态。
 */

import * as React from "react";
import { useAtom, useAtomValue } from "jotai";
import { cn } from "@/lib/utils";
import {
  Settings,
  Radio,
  Palette,
  Info,
  Plug,
  Globe,
  BookOpen,
  Wrench,
  Bot,
  GraduationCap,
  X,
  Keyboard,
  Mic,
  HardDriveDownload,
  HardDrive,
} from "lucide-react";
// Cloud 模式专属图标
import { CreditCard, KeyRound, ScrollText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { settingsTabAtom, channelFormDirtyAtom, settingsCloseRequestedAtom } from "@/atoms/settings-tab";
import type { SettingsTab } from "@/atoms/settings-tab";
import { appModeAtom } from "@/atoms/app-mode";
import { hasUpdateAtom } from "@/atoms/updater";
import { hasEnvironmentIssuesAtom } from "@/atoms/environment";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChannelSettings } from "./ChannelSettings";
import { GeneralSettings } from "./GeneralSettings";
import { ProxySettings } from "./ProxySettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { AboutSettings } from "./AboutSettings";
import { AgentSettings } from "./AgentSettings";
import { PromptSettings } from "./PromptSettings";
import { ToolSettings } from "./ToolSettings";
// Cloud 模式专属组件
import { BillingSettings } from "@/components/billing/BillingSettings";
import { ApiKeysSettings } from "./ApiKeysSettings";
import { UsageSettings } from "./UsageSettings";
import { isCloudMode } from "@/lib/mode";
import { BotHubSettings } from "./BotHubSettings";
import { TutorialViewer } from "../tutorial/TutorialViewer";
import { ShortcutSettings } from "./ShortcutSettings";
import { VoiceInputSettings } from "./VoiceInputSettings";
import { MigrationSettings } from "./MigrationSettings";
import { StorageSettings } from "./StorageSettings";

/** 设置 Tab 定义 */
interface TabItem {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
}

/** 基础 Tabs（所有模式都有） */
const BASE_TABS: TabItem[] = [
  { id: "general", label: "通用设置", icon: <Settings size={16} /> },
  { id: "channels", label: "模型配置", icon: <Radio size={16} /> },
  { id: "prompts", label: "提示词管理", icon: <BookOpen size={16} /> },
  { id: "proxy", label: "代理设置", icon: <Globe size={16} /> },
];

/** Cloud 模式专属 Tab */
const BILLING_TAB: TabItem = {
  id: "billing",
  label: "立即订阅",
  icon: <CreditCard size={16} />,
};

/** Cloud 模式专属 Tab - API Key 管理 */
const API_TAB: TabItem = {
  id: "api",
  label: "开放 API",
  icon: <KeyRound size={16} />,
};

/** Cloud 模式专属 Tab - 用量日志 */
const USAGE_TAB: TabItem = {
  id: "usage",
  label: "用量日志",
  icon: <ScrollText size={16} />,
};

/** Agent 模式专属 Tab */
const AGENT_TAB: TabItem = {
  id: "agent",
  label: "Agent 配置",
  icon: <Plug size={16} />,
};
const TOOLS_TAB: TabItem = {
  id: "tools",
  label: "Chat 工具",
  icon: <Wrench size={16} />,
};
const BOTS_TAB: TabItem = {
  id: "bots",
  label: "远程连接",
  icon: <Bot size={16} />,
};
const TUTORIAL_TAB: TabItem = {
  id: "tutorial",
  label: "Proma 教程",
  icon: <GraduationCap size={16} />,
};
const SHORTCUTS_TAB: TabItem = {
  id: "shortcuts",
  label: "快捷键管理",
  icon: <Keyboard size={16} />,
};
const VOICE_INPUT_TAB: TabItem = {
  id: "voice-input",
  label: "语音输入",
  icon: <Mic size={16} />,
};

/** 尾部 Tabs */
const TAIL_TABS: TabItem[] = [
  { id: "migration", label: "数据迁移", icon: <HardDriveDownload size={16} /> },
  { id: "storage", label: "磁盘管理", icon: <HardDrive size={16} /> },
  { id: "appearance", label: "外观设置", icon: <Palette size={16} /> },
  { id: "about", label: "关于/更新", icon: <Info size={16} /> },
];

/** 根据标签页 id 渲染对应内容 */
function renderTabContent(tab: SettingsTab): React.ReactElement {
  switch (tab) {
    case "general":
      return <GeneralSettings />;
    // Cloud 模式专属页面
    case "billing":
      return <BillingSettings />;
    case "api":
      return <ApiKeysSettings />;
    case "usage":
      return <UsageSettings />;
    case "channels":
      return <ChannelSettings />;
    case "prompts":
      return <PromptSettings />;
    case "proxy":
      return <ProxySettings />;
    case "agent":
      return <AgentSettings />;
    case "tools":
      return <ToolSettings />;
    case "appearance":
      return <AppearanceSettings />;
    case "about":
      return <AboutSettings />;
    case "bots":
      return <BotHubSettings />;
    case "tutorial":
      return <TutorialViewer />;
    case "shortcuts":
      return <ShortcutSettings />;
    case "voice-input":
      return <VoiceInputSettings />;
    case "migration":
      return <MigrationSettings />;
    case "storage":
      return <StorageSettings />;
  }
}

interface SettingsPanelProps {
  onClose?: () => void;
}

export function SettingsPanel({
  onClose,
}: SettingsPanelProps): React.ReactElement {
  const [activeTab, setActiveTab] = useAtom(settingsTabAtom);
  const channelFormDirty = useAtomValue(channelFormDirtyAtom);
  const [closeRequested, setCloseRequested] = useAtom(settingsCloseRequestedAtom);
  const appMode = useAtomValue(appModeAtom);
  const hasUpdate = useAtomValue(hasUpdateAtom);
  const hasEnvironmentIssues = useAtomValue(hasEnvironmentIssuesAtom);

  /** 统一的退出拦截对话框状态 */
  type PendingAction = { type: 'tab'; tabId: SettingsTab } | { type: 'close' } | null
  const [pendingAction, setPendingAction] = React.useState<PendingAction>(null)
  const showNavDialog = pendingAction !== null

  /** 执行待处理的操作 */
  const executePendingAction = (): void => {
    if (!pendingAction) return
    if (pendingAction.type === 'tab') {
      setActiveTab(pendingAction.tabId)
    } else {
      onClose?.()
    }
    setPendingAction(null)
  }

  /** 取消待处理的操作 */
  const cancelPendingAction = (): void => {
    setPendingAction(null)
  }

  /** 切换标签页时检测是否有未保存内容 */
  const handleTabChange = (tabId: SettingsTab): void => {
    if (tabId === activeTab) return
    if (activeTab === 'channels' && channelFormDirty) {
      setPendingAction({ type: 'tab', tabId })
      return
    }
    setActiveTab(tabId)
  }

  /** 关闭设置面板时检测是否有未保存内容 */
  const handleClose = (): void => {
    if (activeTab === 'channels' && channelFormDirty) {
      setPendingAction({ type: 'close' })
      return
    }
    onClose?.()
  }

  // Cmd+W 等外部关闭请求：弹出确认对话框
  React.useEffect(() => {
    if (closeRequested && activeTab === 'channels') {
      setPendingAction({ type: 'close' })
      setCloseRequested(false)
    }
  }, [closeRequested, activeTab, setCloseRequested])

  // Cloud 模式专属 Tab 置顶，随后是 BASE_TABS；Agent 模式在渠道后插入 Agent Tab，记忆/工具 tab 两种模式都显示
  const tabs = React.useMemo(() => {
    const result: TabItem[] = [];
    if (isCloudMode()) {
      result.push(BILLING_TAB);
      result.push(API_TAB);
      result.push(USAGE_TAB);
    }
    result.push(...BASE_TABS);
    if (appMode === "agent") {
      result.push(AGENT_TAB);
    }
    result.push(TOOLS_TAB);
    result.push(VOICE_INPUT_TAB);
    result.push(BOTS_TAB);
    result.push(TUTORIAL_TAB);
    result.push(SHORTCUTS_TAB);
    result.push(...TAIL_TABS);
    return result;
  }, [appMode]);

  // 当前 tab 标题
  const activeTabLabel = tabs.find((t) => t.id === activeTab)?.label ?? "设置";

  return (
    <div className="flex flex-col h-full">
      {/* 顶部 Header 栏 */}
      <div className="h-12 flex items-center justify-between px-5 border-b border-border/50 flex-shrink-0">
        <h2 className="text-sm font-medium text-foreground">
          {activeTabLabel}
        </h2>
        {onClose && (
          <button
            onClick={handleClose}
            className="rounded-md p-1.5 text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* 下方主体：左导航 + 右内容 */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧 Tab 导航 */}
        <div className="w-[160px] border-r border-border/50 pt-3 px-2 flex-shrink-0 overflow-y-auto scrollbar-thin">
          <nav className="flex flex-col gap-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                  activeTab === tab.id
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.id === "about" && (hasUpdate || hasEnvironmentIssues) && (
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* 右侧内容区域 */}
        <ScrollArea className="flex-1">
          <div className="px-6 py-4">{renderTabContent(activeTab)}</div>
        </ScrollArea>
      </div>

      {/* 退出拦截弹窗（侧边栏导航 / X 关闭 / Cmd+W） */}
      <AlertDialog open={showNavDialog} onOpenChange={(open) => { if (!open) cancelPendingAction() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的更改？</AlertDialogTitle>
            <AlertDialogDescription>
              当前渠道配置尚未保存，确定要离开吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelPendingAction}>留在当前页</AlertDialogCancel>
            <AlertDialogAction onClick={executePendingAction}>放弃并离开</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
