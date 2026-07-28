import * as React from "react";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderPlus,
  LoaderCircle,
  MessageSquareText,
  Paperclip,
  Sparkles,
  Wrench,
} from "lucide-react";
import type {
  FileIndexEntry,
  FileSearchResult,
  AgentSessionReferenceSearchResult,
} from "@proma/shared";
import { FileMentionList } from "@/components/file-browser/FileMentionList";
import type { FileMentionRef } from "@/components/file-browser/FileMentionList";
import { cn } from "@/lib/utils";
import {
  createMentionPopup,
  isSuggestionTriggerPresent,
  positionPopup,
} from "./mention-popup-utils";
import {
  filterCommandMenuItems,
  getNextCommandMenuIndex,
  shouldOpenSlashCommandMenu,
} from "./agent-command-menu-state";

type CommandPage = "root" | "skills" | "tools" | "sessions" | "files";
type MentionCharacter = "@" | "/" | "&" | "#";

type CommandAction = "attach-file" | "attach-folder";

interface RootMenuItem {
  id: CommandPage | CommandAction;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  kind: "page" | "action";
  disabled?: boolean;
}

interface ReferenceMenuItem {
  id: string;
  label: string;
  description?: string;
}

export interface AgentCommandActions {
  onAttachFile?: () => void;
  onAttachFolder?: () => void;
}

interface AgentCommandMenuProps {
  query: string;
  workspacePathRef: React.RefObject<string | null>;
  currentSessionIdRef: React.RefObject<string | null>;
  workspaceSlugRef: React.RefObject<string | null>;
  attachedDirsRef: React.RefObject<string[]>;
  sessionAttachedDirsRef: React.RefObject<string[]>;
  actionsRef: React.RefObject<AgentCommandActions>;
  onInsertMention: (
    character: MentionCharacter,
    id: string,
    label: string,
  ) => void;
  onRunAction: (action: CommandAction) => void;
}

export interface AgentCommandMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const EMPTY_FILE_RESULT: FileSearchResult = {
  entries: [],
  total: 0,
  sessionEntries: [],
  workspaceEntries: [],
};

function getRootMenuItems(): RootMenuItem[] {
  return [
    {
      id: "skills",
      label: "调用 Skill",
      description: "选择当前工作区已启用的 Skill",
      icon: Sparkles,
      kind: "page",
    },
    {
      id: "sessions",
      label: "引用会话",
      description: "引用其他 Agent 会话",
      icon: MessageSquareText,
      kind: "page",
    },
    {
      id: "files",
      label: "引用文件",
      description: "选择会话文件或工作区文件",
      icon: FileText,
      kind: "page",
    },
    {
      id: "attach-file",
      label: "添加附件",
      description: "从本机选择文件附加到消息",
      icon: Paperclip,
      kind: "action",
    },
    {
      id: "attach-folder",
      label: "附加文件夹",
      description: "授权 Agent 访问一个文件夹",
      icon: FolderPlus,
      kind: "action",
    },
    {
      id: "tools",
      label: "MCP 工具",
      description: "选择当前 Agent 可用的 MCP 工具",
      icon: Wrench,
      kind: "page",
    },
  ];
}

function menuTitle(page: CommandPage): string {
  switch (page) {
    case "skills":
      return "Skills";
    case "tools":
      return "MCP 工具";
    case "sessions":
      return "引用会话";
    case "files":
      return "引用文件";
    default:
      return "命令";
  }
}

function menuHint(page: CommandPage): string {
  return page === "root"
    ? "↑ ↓ 选择  ·  → 或 Enter 进入  ·  Esc 关闭"
    : "↑ ↓ 选择  ·  ← 返回  ·  Enter 确认  ·  Esc 关闭";
}

function menuEmptyText(page: CommandPage, loading: boolean): string {
  if (loading) return "正在加载…";
  switch (page) {
    case "skills":
      return "没有已启用的 Skill";
    case "tools":
      return "没有可用的 MCP 工具";
    case "sessions":
      return "没有可引用的会话";
    case "files":
      return "没有可引用的文件";
    default:
      return "没有匹配的命令";
  }
}

const AgentCommandMenu = React.forwardRef<
  AgentCommandMenuRef,
  AgentCommandMenuProps
>(function AgentCommandMenu(
  {
    query,
    workspacePathRef,
    currentSessionIdRef,
    workspaceSlugRef,
    attachedDirsRef,
    sessionAttachedDirsRef,
    actionsRef,
    onInsertMention,
    onRunAction,
  },
  ref,
) {
  const [page, setPage] = React.useState<CommandPage>("root");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [skills, setSkills] = React.useState<ReferenceMenuItem[]>([]);
  const [tools, setTools] = React.useState<ReferenceMenuItem[]>([]);
  const [sessions, setSessions] = React.useState<ReferenceMenuItem[]>([]);
  const [fileResult, setFileResult] =
    React.useState<FileSearchResult>(EMPTY_FILE_RESULT);
  const [sessionSearchQuery, setSessionSearchQuery] = React.useState(query);
  const fileListRef = React.useRef<FileMentionRef>(null);
  const menuScrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [page, query]);

  React.useEffect(() => {
    if (page !== "sessions") return;

    const timer = window.setTimeout(() => {
      setSessionSearchQuery(query.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [page, query]);

  React.useEffect(() => {
    let disposed = false;

    const loadPage = async (): Promise<void> => {
      if (page === "root") return;
      setLoading(true);
      try {
        if (page === "skills" || page === "tools") {
          const slug = workspaceSlugRef.current;
          if (!slug) return;
          const capabilities =
            await window.electronAPI.getWorkspaceCapabilities(slug);
          if (disposed) return;
          if (page === "skills") {
            setSkills(
              capabilities.skills
                .filter((skill) => skill.enabled)
                .map((skill) => ({
                  id: skill.slug,
                  label: skill.name,
                  description: skill.description,
                })),
            );
          } else {
            setTools(
              capabilities.mcpServers
                .filter((server) => server.enabled)
                .map((server) => ({
                  id: server.name,
                  label: server.name,
                  description: server.type,
                })),
            );
          }
          return;
        }

        if (page === "sessions") {
          const result = await window.electronAPI.searchAgentSessionReferences({
            excludeSessionId: currentSessionIdRef.current ?? undefined,
            query: sessionSearchQuery || undefined,
            limit: sessionSearchQuery ? 20 : 200,
          });
          if (disposed) return;
          setSessions(
            result.map((session: AgentSessionReferenceSearchResult) => ({
              id: session.sessionId,
              label: session.title,
              description: session.snippet,
            })),
          );
          return;
        }

        const workspacePath = workspacePathRef.current;
        if (!workspacePath) return;
        const attachedDirs = attachedDirsRef.current ?? [];
        const sessionAttachedDirs = sessionAttachedDirsRef.current ?? [];
        const result = await window.electronAPI.searchWorkspaceFiles(
          workspacePath,
          "",
          200,
          attachedDirs.length > 0 ? attachedDirs : undefined,
          sessionAttachedDirs.length > 0 ? sessionAttachedDirs : undefined,
        );
        if (!disposed) setFileResult(result);
      } catch (error) {
        console.error("[AgentCommandMenu] 加载菜单数据失败:", error);
        if (!disposed) {
          setSkills([]);
          setTools([]);
          setSessions([]);
          setFileResult(EMPTY_FILE_RESULT);
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void loadPage();
    return () => {
      disposed = true;
    };
  }, [
    page,
    sessionSearchQuery,
    workspacePathRef,
    currentSessionIdRef,
    workspaceSlugRef,
    attachedDirsRef,
    sessionAttachedDirsRef,
  ]);

  const rootItems = React.useMemo(
    () => filterCommandMenuItems(getRootMenuItems(), query),
    [actionsRef, query],
  );
  const referenceItems = React.useMemo(() => {
    const source =
      page === "skills" ? skills : page === "tools" ? tools : sessions;
    return filterCommandMenuItems(source, query);
  }, [page, skills, tools, sessions, query]);

  const selectRootItem = React.useCallback(
    (item: RootMenuItem): void => {
      if (item.disabled) return;
      if (item.kind === "page") {
        setPage(item.id as CommandPage);
        return;
      }
      onRunAction(item.id as CommandAction);
    },
    [onRunAction],
  );

  const selectReferenceItem = React.useCallback(
    (item: ReferenceMenuItem): void => {
      const character: MentionCharacter =
        page === "skills" ? "/" : page === "tools" ? "#" : "&";
      onInsertMention(character, item.id, item.label);
    },
    [onInsertMention, page],
  );

  React.useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (page === "files") {
          return fileListRef.current?.onKeyDown({ event }) ?? false;
        }

        const items = page === "root" ? rootItems : referenceItems;
        if (event.key === "ArrowUp") {
          setSelectedIndex((current) =>
            getNextCommandMenuIndex(current, -1, items.length),
          );
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((current) =>
            getNextCommandMenuIndex(current, 1, items.length),
          );
          return true;
        }
        if (event.key === "ArrowLeft") {
          if (page !== "root") {
            setPage("root");
            return true;
          }
          return false;
        }
        if (event.key === "ArrowRight" || event.key === "Enter") {
          const item = items[selectedIndex];
          if (!item) return true;
          if (page === "root") selectRootItem(item as RootMenuItem);
          else selectReferenceItem(item);
          return true;
        }
        return false;
      },
    }),
    [
      page,
      rootItems,
      referenceItems,
      selectedIndex,
      selectRootItem,
      selectReferenceItem,
    ],
  );

  const isFilePage = page === "files";
  const hasItems = isFilePage
    ? fileResult.sessionEntries.length > 0 ||
      fileResult.workspaceEntries.length > 0
    : (page === "root" ? rootItems.length : referenceItems.length) > 0;

  React.useEffect(() => {
    if (isFilePage) return;
    const container = menuScrollRef.current;
    if (!container) return;
    const selected = container.querySelector<HTMLElement>(
      `[data-command-menu-index="${selectedIndex}"]`,
    );
    selected?.scrollIntoView({ block: "nearest" });
  }, [
    isFilePage,
    page,
    selectedIndex,
    rootItems.length,
    referenceItems.length,
  ]);

  return (
    <div
      className="w-[min(25rem,calc(100vw-2rem))] overflow-hidden rounded-lg bg-popover shadow-xl"
      role="dialog"
      aria-label="Agent 命令菜单"
    >
      <div className="flex items-center gap-2 border-b border-border/50 bg-muted/40 px-3 py-2">
        {page !== "root" && (
          <ChevronLeft className="size-3.5 text-muted-foreground" />
        )}
        <span className="text-xs font-semibold text-foreground">
          {menuTitle(page)}
        </span>
        {page === "skills" && (
          <span className="text-[11px] text-muted-foreground">
            继续输入以搜索
          </span>
        )}
        {loading && (
          <LoaderCircle className="ml-auto size-3.5 animate-spin text-muted-foreground" />
        )}
      </div>
      <div ref={menuScrollRef} className="h-[22rem] overflow-y-auto p-1.5">
        {isFilePage ? (
          hasItems ? (
            <FileMentionList
              ref={fileListRef}
              sessionEntries={fileResult.sessionEntries}
              workspaceEntries={fileResult.workspaceEntries}
              onSelect={(file: Pick<FileIndexEntry, "name" | "path">) =>
                onInsertMention("@", file.path, file.name)
              }
              onBack={() => setPage("root")}
              embedded
            />
          ) : (
            <MenuEmpty text={menuEmptyText(page, loading)} />
          )
        ) : hasItems ? (
          <div role="listbox" aria-label={menuTitle(page)}>
            {(page === "root" ? rootItems : referenceItems).map(
              (item, index) => {
                const rootItem = item as RootMenuItem;
                const Icon =
                  page === "root"
                    ? rootItem.icon
                    : page === "skills"
                      ? Sparkles
                      : page === "tools"
                        ? Wrench
                        : MessageSquareText;
                const selected = index === selectedIndex;
                const disabled = page === "root" && rootItem.disabled;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-command-menu-index={index}
                    disabled={disabled}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors",
                      selected && "bg-accent text-accent-foreground",
                      !selected && !disabled && "hover:bg-accent/60",
                      disabled && "cursor-not-allowed opacity-45",
                    )}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      if (page === "root") selectRootItem(rootItem);
                      else selectReferenceItem(item as ReferenceMenuItem);
                    }}
                  >
                    <Icon className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {item.label}
                      </span>
                      {item.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      )}
                    </span>
                    {page === "root" && rootItem.kind === "page" && (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                );
              },
            )}
          </div>
        ) : (
          <MenuEmpty text={menuEmptyText(page, loading)} />
        )}
      </div>
      <div className="border-t border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
        {menuHint(page)}
      </div>
    </div>
  );
});

function MenuEmpty({ text }: { text: string }): React.ReactElement {
  return (
    <div className="px-2.5 py-5 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}

interface SlashSuggestionItem {
  id: string;
}

export function createAgentCommandSuggestion(
  workspacePathRef: React.RefObject<string | null>,
  currentSessionIdRef: React.RefObject<string | null>,
  workspaceSlugRef: React.RefObject<string | null>,
  attachedDirsRef: React.RefObject<string[]>,
  sessionAttachedDirsRef: React.RefObject<string[]>,
  actionsRef: React.RefObject<AgentCommandActions>,
): Omit<SuggestionOptions<SlashSuggestionItem>, "editor"> {
  return {
    char: "/",
    allowSpaces: false,
    allowedPrefixes: null,
    items: () => [{ id: "agent-command-root" }],
    allow: ({ state }) => shouldOpenSlashCommandMenu(state.doc.textContent),
    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: "mention", attrs: props },
          { type: "text", text: " " },
        ])
        .run();
    },
    render: () => {
      let renderer: ReactRenderer<AgentCommandMenuRef> | null = null;
      let popup: HTMLDivElement | null = null;
      let blurHandler: (() => void) | null = null;
      let editorDom: HTMLElement | null = null;
      let activeProps: SuggestionProps<SlashSuggestionItem> | null = null;

      const removeTrigger = (): void => {
        const props = activeProps;
        if (!props) return;
        props.editor.chain().focus().deleteRange(props.range).run();
      };

      const insertMention = (
        character: MentionCharacter,
        id: string,
        label: string,
      ): void => {
        activeProps?.command({
          id,
          label,
          mentionSuggestionChar: character,
          commandMenuMention: true,
        });
      };

      const runAction = (action: CommandAction): void => {
        const actions = actionsRef.current ?? {};
        removeTrigger();
        requestAnimationFrame(() => {
          if (action === "attach-file") actions.onAttachFile?.();
          if (action === "attach-folder") actions.onAttachFolder?.();
        });
      };

      const cleanup = (): void => {
        if (blurHandler && editorDom) {
          editorDom.removeEventListener("blur", blurHandler, true);
          blurHandler = null;
        }
        editorDom = null;
        activeProps = null;
        popup?.remove();
        popup = null;
        renderer?.destroy();
        renderer = null;
      };

      const getRendererProps = (
        props: SuggestionProps<SlashSuggestionItem>,
      ) => ({
        query: props.query,
        workspacePathRef,
        currentSessionIdRef,
        workspaceSlugRef,
        attachedDirsRef,
        sessionAttachedDirsRef,
        actionsRef,
        onInsertMention: insertMention,
        onRunAction: runAction,
      });

      return {
        onStart(props) {
          if (popup || renderer) cleanup();
          if (!isSuggestionTriggerPresent(props.editor, props.range, "/"))
            return;

          activeProps = props;
          editorDom = props.editor.view.dom;
          renderer = new ReactRenderer(AgentCommandMenu, {
            props: getRendererProps(props),
            editor: props.editor,
          });
          popup = createMentionPopup(renderer.element);
          positionPopup(popup, props.clientRect?.());

          blurHandler = () => {
            setTimeout(() => {
              if (!props.editor.view.hasFocus() && popup) cleanup();
            }, 100);
          };
          editorDom.addEventListener("blur", blurHandler, true);
        },
        onUpdate(props) {
          activeProps = props;
          renderer?.updateProps(getRendererProps(props));
          positionPopup(popup, props.clientRect?.());
        },
        onKeyDown(props) {
          return renderer?.ref?.onKeyDown({ event: props.event }) ?? false;
        },
        onExit() {
          cleanup();
        },
      };
    },
  };
}
