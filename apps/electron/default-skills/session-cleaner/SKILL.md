---
name: session-cleaner
description: 清洗 Proma 会话 JSONL 文件为干净可读的 Markdown 对话。过滤流式传输产生的拼接单字和冗余快照,只保留用户发言、助手回复正文与工具调用摘要(丢弃 thinking / 原始 tool_result)。当用户提到"清洗会话""解析对话文件""提取对话上下文""过滤流式冗余""导出会话 Markdown""把会话转成对话""整理 agent-sessions"时使用此技能。支持单个会话(按 id 或文件路径)和 --all 批量清洗。
version: 1.0.0
license: MIT
---

# Session Cleaner

把 `~/.proma/agent-sessions/<id>.jsonl` 里被流式传输污染过的内容,清洗为干净 Markdown 对话。

## 为什么需要它

Proma 会话文件是 JSONL,但里面混了两层噪音:

1. **流式快照冗余**(格式 B)—— 同一个 assistant 回合被拆成多行,每行是该回合的完整快照,
   早先的文本块被反复重发 → 文件里出现大量"拼接单字"和重复段落。
2. **旧扁平格式冗余**(格式 A)—— 空 assistant 行、重复 user 行、叙述被拼成长串。

本技能自动识别两种格式,输出干净的 `## 用户` / `## 助手` 分段 Markdown,
工具调用压缩成一行 `> [工具: name args]` 摘要,thinking 与原始 tool_result 全部丢弃。

## 用法

**输出位置约定:** 默认输出到**当前会话专用文件夹**下的 `cleaned/` 子目录,即 `<当前会话工作目录>/cleaned/<session_id>.clean.md`。Agent 调用时必须用 `--out` 显式指向当前会话目录,例如:

```bash
python scripts/clean_session.py <session_id> --out "<当前会话cwd>/cleaned"
```

不要省略 `--out`,否则文件会写到脚本运行时的 shell CWD 下(可能不是会话目录)。

```bash
# 单会话(用 session id)
python scripts/clean_session.py <session_id> --out "<当前会话cwd>/cleaned"

# 单会话(用完整文件路径)
python scripts/clean_session.py "~/.proma/agent-sessions/<id>.jsonl" --out "<当前会话cwd>/cleaned"

# 批量清洗全部会话
python scripts/clean_session.py --all --out "<当前会话cwd>/cleaned"

# 不写文件,直接输出到 stdout(适合管道或快速预览)
python scripts/clean_session.py <session_id> --stdout
```

## 输出示例

```markdown
# Session: <session-id>

> 自动清洗自 `<session-id>.jsonl`,流式快照与工具回包已过滤。

## 用户

我想做个跨会话的内容解析脚本...

## 助手

会话文件存放于 `~/.proma/agent-sessions/`,让我先查一下格式。

> [工具: Glob pattern=~/.proma/agent-sessions/*.jsonl]
> [工具: Read file_path=~/.proma/agent-sessions/<id>.jsonl limit=25]

## 用户

你还没写计划。

## 助手

好的,马上写。
```

## 触发词(描述已涵盖)

清洗会话 / 解析对话文件 / 提取对话上下文 / 过滤流式冗余单字 / 导出会话 Markdown /
整理 agent-sessions / 把会话转成对话 / session transcript cleanup

## 文件结构

```
skills/session-cleaner/
├── SKILL.md                                    # 本文件
├── scripts/
│   └── clean_session.py                        # 核心清洗脚本
└── references/
    └── session-format-spec.md                  # 两种会话格式的字段规格
```

## 实现要点

- **格式自动识别**:首行探测 `type`+`message` → 格式 B;`role`+字符串 `content` → 格式 A。
- **格式 B 合并**:按 `message.id` 分组 assistant 行,取最后一行(最完整快照)的 content 数组。
- **块过滤**:
  - `text` → 保留原文
  - `tool_use` → 压缩为 `> [工具: name args]`
  - `thinking` / `tool_result` → 丢弃
- **格式 A 去重**:相邻相同 user 合并,空 assistant 丢。
- **容错**:JSON 解析失败静默跳过,不中断批处理。

详细字段规格见 `references/session-format-spec.md`。
