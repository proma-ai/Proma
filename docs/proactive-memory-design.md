# Proma Proactive Memory 设计文档

> 版本：1.0（MVP 实现）
> 日期：2026-08-02
> 关联：`docs/proactive-scheduler-monitor-design.md`（Proactive Center 方向蓝图，本实现是其 Memory 部分的落地）
> 参考：TencentDB-Agent-Memory（L0→L3 分层）、ProactiveAgent（ICLR 2025，误报控制）

## 1. 背景与目标

Proma 现有的 Auto Memory（`.claude/memory/MEMORY.md`）依赖 Agent 在 prompt 引导下自觉维护，缺少**自动提取**与**跨会话自动召回**两个关键能力。本设计为 Proma 增加官方级 **Proactive Memory** 能力：

1. **主动记忆（Proactive Capture）**：Agent 会话结束后自动从对话提取结构化长期记忆（L1 atoms），去重沉淀。
2. **主动回忆（Proactive Recall）**：新会话/新消息时自动检索相关记忆注入上下文，并稳定注入用户画像（persona）。
3. **误报控制（False-Alarm Control）**：参考 ProactiveAgent 论文，主动性产品的头号杀手是"忍不住提议"——本实现用归一化评分阈值 + 停用词过滤 + 回忆意图降级三件套控制误报。
4. **反馈回流（Feedback Loop）**：用户确认/拒绝行为纠正后，自动更新用户画像，让记忆随反馈进化。

## 2. 分层模型

参考 TencentDB-Agent-Memory 的 L0→L3 语义金字塔，适配 Proma 本地优先架构：

```
┌──────────────────────────────────────────────────┐
│ L3 Persona    profile.md（用户画像，稳定注入）     │
├──────────────────────────────────────────────────┤
│ L2 Scene      场景块 markdown（占位，后续）        │
├──────────────────────────────────────────────────┤
│ L1 Atom       结构化记忆条目（LLM 提取 + 去重）    │
├──────────────────────────────────────────────────┤
│ L0 Raw        会话 JSONL（复用 session-core）      │
└──────────────────────────────────────────────────┘
```

| 层 | 存储 | 说明 |
|---|---|---|
| L0 | 已有会话 JSONL | Proma 已有能力，不重复建模 |
| L1 | `atoms/{YYYY-MM-DD}.jsonl` | 原子记忆，按天分文件 append-only，fingerprint 去重 |
| L2 | `scenes/{sceneId}.md` | 场景聚合（MVP 占位，接口已备） |
| L3 | `profile.md` | 用户画像，LLM 生成 + 规则版兜底，Markdown 白盒可审计 |

## 3. 存储布局（local-first）

```text
~/.proma/memory/
  index.json            # 元数据 / 启用状态 / 最近提取时间
  profile.md            # L3 用户画像
  atoms/{YYYY-MM-DD}.jsonl   # L1 原子记忆
  scenes/{sceneId}.md   # L2 场景块
  corrections.json      # 行为纠正候选（pending / active / rejected / superseded）
  memory_log/{YYYY-MM-DD}.md # 每日记忆变更日志
```

设计原则：
- **本地优先**：全部 JSONL/markdown，无外部数据库依赖
- **崩溃安全**：复用 `safe-file` 原子写（write-to-temp → rename + .bak 容错）
- **可审计**：记忆日志、纠正状态、persona 均为人类可读文件

## 4. 核心模块

```
apps/electron/src/main/lib/memory/
  store.ts               # 存储层：atoms/corrections/persona/log/stats
  recall.ts              # 召回：分词/评分/阈值/同义词扩展/意图降级
  extractor.ts           # LLM 提取：OpenAI 兼容端点 + JSON 容错解析
  persona.ts             # L3 画像：LLM 生成/增量更新 + 规则版兜底
  service.ts             # 编排：capture/recall/persona/corrections 对外 API
  memory-agent-tools.ts  # Claude runtime 内置 MCP 工具
  *.test.ts              # 单元测试（纯函数）
```

### 4.1 存储层（store.ts）

- `writeAtom` / `writeAtomWithDedup`：写入原子记忆，fingerprint + 包含度双重去重
- `addCorrection` / `listCorrections` / `updateCorrectionStatus`：行为纠正审批流
- `writePersona` / `readPersonaRaw` / `parsePersonaProfile`：画像读写与结构化解析
- `getMemoryStats` / `appendMemoryLog`：统计与变更日志

### 4.2 召回引擎（recall.ts）

**分词**：中文单字 + bigram + 英文单词；bigram 是主信号，单字权重 0.15。

**评分**：BM25 简化版 → 归一化到 0-1（除以当前查询最大分）。

**误报控制三件套**：
1. 停用词过滤：中文/英文高频功能词（帮/我/一/个/的/了…）不参与查询
2. 归一化阈值：`RECALL_MIN_SCORE=0.12`，低于阈值不注入
3. 回忆意图降级：查询含"记得/我是谁/名字"等意图词且 0 命中时，返回最近记忆（保 Recall）

**同义词扩展**：静态表解决转喻（"编程语言"→TypeScript/Rust；"名字"→Conrad）。

**注入格式**：`<memory_context>` 块，每条带 `[type|date|rel=high/mid/low]` 强度标注。

### 4.3 LLM 提取（extractor.ts）

- 配置：本地 `.env` 的 `MEMORY_LLM_API_KEY/BASE_URL/MODEL`（OpenAI 兼容端点）
- Prompt：要求"只写对话中明确出现的"，type 限 fact/preference/correction/sop/todo_context
- **reasoning 模型兼容**：`deepseek-v4-flash` 等模型不兼容 `response_format=json_object`（思考占满 token），因此去掉强制格式、max_tokens=4096，解析层做围栏剥离 + 区间提取双容错
- 失败降级：LLM 失败返回空数组 → service 回退规则版（识别"以后/下次/记住"等纠正信号）

### 4.4 Persona 生成（persona.ts）

- LLM 从 L1 atoms 生成/增量更新画像（称呼/一句话定位/长期偏好/交互协议/演进轨迹）
- 增量更新：输入已有 persona + 新 atoms，保留稳定内容只更新有证据的变化
- 规则版兜底：无 LLM 时从 atoms 提取姓名/偏好/纠正拼基础画像
- **反馈回流**：确认纠正 → 触发 persona 刷新，交互协议反映用户认可的行为规则

### 4.5 编排（service.ts）

对外稳定 API：`contextForMessage` / `search` / `captureCandidate` / `extractFromConversation` / `extractAndCapture` / `ensurePersona` / `confirmCorrection` / `rejectCorrection` / `stats` / `persona`。

## 5. 接线（Proma Runtime）

| 接线点 | 文件 | 说明 |
|---|---|---|
| 存储路径 | `config-paths.ts` | `getMemoryRootDir()` 等路径函数 |
| 动态上下文 | `agent-prompt-builder.ts` | `buildDynamicContext` 注入 `<memory_context>`（per-message 检索）；`buildSystemPrompt` 注入 `<persona_profile>`（稳定） |
| 会话结束钩子 | `agent-orchestrator.ts` | `completeRun`/`failRun` 后 fire-and-forget 调 `captureMemoryFromRun` |
| 内置 MCP | `default-mcp.json` + `registry.ts` + `pi-builtin-tools.ts` | Claude/Pi 双 runtime 暴露 `memory_search` / `memory_capture` / `memory_stats` / `memory_corrections` / `memory_confirm_correction` / `memory_reject_correction` |
| UI IPC | `ipc.ts` + `preload/index.ts` | `getMemoryStats` / `searchMemory` / `listMemoryCorrections` / `confirmMemoryCorrection` / `rejectMemoryCorrection` / `readMemoryPersona` |
| 记忆看板 | `ProactiveMemoryPanel.tsx` | 统计卡片、纠正审批、搜索、persona 预览（嵌入 `WorkspaceMemoryTab`） |
| 每日整理 | `default-skills/memory-daily/SKILL.md` | 指导 Agent 整理记忆 + 建议创建 daily automation |

## 6. 验证结果

- 全量 typecheck：6 包全绿
- 全量测试：529 pass / 3 fail（3 fail 为既有 Electron 环境问题，与本次无关）
- 真实 LLM 提取（DeepSeek v4 Flash）：对话 → fact/preference/sop 提取准确
- 误报控制矩阵：
  | 查询 | 结果 |
  |---|---|
  | 你用什么编程语言？ | 2 条精准（同义词扩展） |
  | 帮我写一个排序算法 | 0 条（正确拒绝误报） |
  | 今天天气怎么样 | 0 条（正确沉默） |
  | 你还记得我是谁吗 | fallback 返回最近记忆（保 Recall） |
- Persona 生成 + 反馈回流：确认纠正后交互协议自动更新
- UI 实测：统计/审批/搜索/画像四项用户验证通过

## 7. 后续（非 MVP 范围）

- L2 场景聚合（接口已备，`scenes/` 目录占位）
- embedding 召回（当前关键词 BM25；后续可加向量检索提升语义召回）
- memory-daily 定时任务的 UI 一键创建
- 记忆命中反馈（用户接受/忽略信号影响后续注入频率——ProactiveAgent P12 轻量三态）

## 8. 参考

- TencentDB-Agent-Memory（L0→L3 分层、符号化短期记忆、Markdown 白盒）
- ProactiveAgent（ICLR 2025，误报控制、统一接受率目标、轻量三态交互）
- MineContext（主动推送节奏、Feed 交互设计）
- Proma `docs/proactive-scheduler-monitor-design.md`（Proactive Center 方向蓝图）
