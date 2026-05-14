# Guizang PPT Skill · 网页 PPT / 配图 / 封面

> 🌏 **English version: [README.en.md](./README.en.md)**

一个适配 Claude Code / Codex 等 Agent 环境的网页 PPT 技能,用于生成**单文件 HTML 横向翻页 PPT**、PPT 配图和多平台封面。

内置两套视觉系统:

- **Style A: 电子杂志 × 电子墨水**。像 *Monocle* 贴上了代码,适合叙事、观点、分享、个人风格表达。
- **Style B: 瑞士国际主义**。网格至上、单一高饱和锚点色、直角、发丝线、极致字号对比,适合事实、产品、分析、方法论表达。

> 由 [歸藏](https://x.com/op7418) 在"一人公司:被 AI 折叠的组织"、"一种新的工作方式"等线下分享中沉淀而成,踩过的每一个坑都写进了 `checklist.md`。

**旧主题 · Style A 电子杂志风**

![Style A 电子杂志风效果展示](https://github.com/user-attachments/assets/5dc316a2-401c-4e37-9123-ea081b6ae470)

**新主题 · Style B 瑞士国际主义**

![Style B 瑞士国际主义效果展示](https://github.com/user-attachments/assets/8960e78c-69bb-4b7e-aa95-6fad64b70314)

## 效果

- 🖋 **双视觉系统**:电子杂志风负责叙事,瑞士风负责事实表达
- 📐 **横向左右翻页**:键盘 ← → / 滚轮 / 触屏滑动 / 底部圆点 / ESC 索引
- 🧩 **Style A 10 种布局**:封面、章节、数据大字报、图文、图片网格、Pipeline、对比等
- 🧱 **Style B 22 种锁定版式**:Cover、Statement、KPI Tower、Loop Diagram、Duo Compare、Image Hero、Closing Manifesto 等
- 🎨 **主题色预设**:Style A 5 套电子墨水主题,Style B 4 套瑞士高饱和锚点色
- 🖼 **Codex 可选配图流程**:可用 GPT-Image 2.0 / GPT-M 2.0 生成纪实照片、信息图、流程图、系统关系图、UI 情景图,并按模板比例插入
- 📰 **多平台封面**:可用同一套视觉规则生成公众号 21:9、公众号分享卡 1:1、小红书 3:4、视频号横版等封面
- 📴 **低性能静态模式**:按 `B` 可关闭 WebGL / canvas 动画,让动态内容退回静态背景
- 📄 **单文件 HTML**:不需要构建、不需要服务器,浏览器直接打开

## 适合 / 不适合

**✅ 合适**:线下分享 / 行业内部讲话 / 私享会 / AI 产品发布 / demo day / 带强烈个人风格的演讲

**❌ 不合适**:大段表格数据 / 培训课件(信息密度不够)/ 需要多人协作编辑(静态 HTML)

## 安装

### 方式一:一行命令安装(推荐)

```bash
npx skills add https://github.com/op7418/guizang-ppt-skill --skill guizang-ppt-skill
```

### 方式二:把下面这段话直接发给 AI

> 帮我安装 `guizang-ppt-skill` 这个 Claude Code skill。请按下面步骤做:
>
> 1. 确保 `~/.claude/skills/` 目录存在(不存在就创建)
> 2. 执行 `git clone https://github.com/op7418/guizang-ppt-skill.git ~/.claude/skills/guizang-ppt-skill`
> 3. 验证:`ls ~/.claude/skills/guizang-ppt-skill/` 应该看到 `SKILL.md`、`assets/`、`references/` 三项
> 4. 告诉我安装好了,之后我说"做一份杂志风 PPT"之类的话就会触发这个 skill

把这段话复制粘贴给 Claude Code / Cursor / 任何有 shell 权限的 AI Agent,它会自动完成安装。

### 方式三:手动命令行

```bash
git clone https://github.com/op7418/guizang-ppt-skill.git ~/.claude/skills/guizang-ppt-skill
```

### 触发方式

装好后,Claude Code 会在对话里自动发现并调用这个 skill。触发关键词:

- "帮我做一份杂志风 PPT"
- "帮我做一份瑞士风 PPT"
- "生成一个 horizontal swipe deck"
- "editorial magazine style presentation"
- "electronic ink 风格演讲 slides"
- "基于这篇文章做一张公众号 21:9 封面"
- "基于这份 PPT 生成一张 1:1 分享卡"

## 使用流程

Skill 本身是结构化工作流,Agent 会逐步引导:

1. **选择风格** — Style A 电子杂志风,或 Style B 瑞士国际主义
2. **需求澄清** — 6 问清单:受众、时长、素材、图片、主题色、硬约束
3. **拷贝模板** — Style A 用 `assets/template.html`,Style B 用 `assets/template-swiss.html`
4. **填充内容** — 先做主题节奏表,再从对应 layout 骨架里挑、粘、改文案
5. **可选配图** — 在 Codex 中询问是否用 GPT-Image 2.0 / GPT-M 2.0 生成配图,再按页面比例插入
6. **自检** — 对照 `references/checklist.md`,P0 级问题必须全过；瑞士风还要运行版式校验器
7. **预览** — 浏览器直接打开
8. **迭代** — inline style 改字号/高度/间距

详细说明见 [`SKILL.md`](./SKILL.md)。

## Style B 瑞士风

瑞士风是这次新增的结构化主题。它不是"换一套 CSS",而是一套更严格的版式系统。

- **22 个具名版式**:正文页只能从 `S01` 到 `S22` 中选择,不能临时发明页面结构
- **4 套锚点色**:克莱因蓝 IKB、柠檬黄、柠檬绿、安全橙
- **网格锁定**:16 列 grid、直角色块、1px 发丝线、无阴影、无渐变、无圆角
- **中文字号收敛**:全中文大标题需要降一档,避免占掉正文和图片空间
- **图文底对齐**:左文右图 / 左图右文场景优先让正文块与图片底部对齐,同时避开页脚翻页组件
- **图片槽位绑定**:图片必须进入模板预留的 `data-image-slot`,常见主图按 21:9 或 16:10 生成
- **强校验**:用脚本拦住居中标题、实验版式、SVG 内写字、图片脱离槽位等问题

瑞士风校验命令:

```bash
node scripts/validate-swiss-deck.mjs path/to/index.html
```

## Codex 配图能力

在 Codex 环境中,完成 deck 初稿后可以主动询问用户是否需要生成配图。用户确认后,再询问图片类型或风格,常用类型包括:

- 人文纪实照片:富士 / 徕卡感的真实场景,增加人文表现力
- 信息图 / 流程图 / 对比图 / 系统关系图:用于解释无法用实拍照片说明的概念
- 截图再设计 / UI 情景图:把原始截图统一成适合 PPT 的比例和视觉密度
- 数据大字报 / 数据图表:把关键数字做成可直接插入 PPT 的视觉素材
- 多图拼贴:用于极宽图片槽位,避免把三张 16:9 图片硬塞进三列

生成图片时要遵守三个关键规则:

- 图片是 PPT 中的嵌入素材,不要自带页脚、页底、标题、角标、页码或装饰边框
- 图片语言跟随 deck 语言:中文 deck 的信息图用中文标签,英文 deck 用英文标签
- 图片比例必须先匹配落位:瑞士风主图常用 21:9,通用主图常用 16:9 / 16:10,截图再设计常用 16:10,多图网格统一高度

配图提示词见 [`references/image-prompts.md`](./references/image-prompts.md)。

## 封面生成

这个 Skill 也可以基于文章或 PPT 核心观点生成平台封面。典型规格:

- **公众号头图**:21:9,主标题优先,右侧或边缘保留视觉锚点
- **公众号分享卡**:1:1,与头图共用主题色、关键词和视觉元素
- **小红书封面 / 轮播**:3:4,大标题优先,多张时统一字号和视觉节奏
- **视频号 / 横版封面**:16:9,适合标题 + 副标题 + 单一视觉焦点

封面原则和 PPT 一样:只用少量关键词,视觉重心落在大标题上,不要把正文堆满。

## 目录结构

```
guizang-ppt-skill/
├── SKILL.md              ← Skill 主文件:工作流、原则、常见错误
├── README.md             ← 本文件
├── assets/
│   ├── template.html         ← Style A 电子杂志风模板
│   └── template-swiss.html   ← Style B 瑞士国际主义模板
├── scripts/
│   └── validate-swiss-deck.mjs ← 瑞士风版式校验器
└── references/
    ├── components.md     ← 组件手册(字体、色、网格、图标、callout、stat、pipeline)
    ├── layouts.md        ← 10 种页面布局骨架(可直接粘贴)
    ├── layouts-swiss.md  ← 22 种瑞士风锁定版式
    ├── swiss-layout-lock.md ← 瑞士风还原度和版式硬约束
    ├── themes.md         ← 5 套主题色预设(只能选不能自定义)
    ├── themes-swiss.md   ← 4 套瑞士风锚点色
    ├── image-prompts.md  ← GPT-Image 2.0 / GPT-M 2.0 配图类型、比例和基础提示词
    └── checklist.md      ← 质量检查清单(P0 / P1 / P2 / P3 分级)
```

## 主题色预设

从 `references/themes.md` 里选一套——**不允许自定义 hex 值**,保护美学比给自由更重要。

| 主题 | 适合场景 |
|------|---------|
| 🖋 墨水经典 | 通用默认、商业发布、不知道选啥 |
| 🌊 靛蓝瓷 | 科技 / 研究 / AI / 技术发布会 |
| 🌿 森林墨 | 自然 / 可持续 / 文化 / 非虚构 |
| 🍂 牛皮纸 | 怀旧 / 人文 / 文学 / 独立杂志 |
| 🌙 沙丘 | 艺术 / 设计 / 创意 / 画廊 |

切换主题只需替换 `template.html` 开头 `:root{}` 里的 6 行变量,其他 CSS 全走 `var(--...)`。

### Style B 瑞士主题

瑞士风从 `references/themes-swiss.md` 里选一套,同样**不允许自定义 hex 值**。

| 主题 | 适合场景 |
|------|---------|
| 克莱因蓝 IKB | 通用默认、商业发布、AI 产品、方法论 |
| 柠檬黄 | 年轻、运动、零售、Y2K 复古 |
| 柠檬绿 | 生态、可持续、Z 世代品牌 |
| 安全橙 | 警示、新闻、活力主题 |

如果用户说"瑞士风 PPT"但没有指定颜色,默认推荐克莱因蓝 IKB。

## 核心设计原则

1. **克制优于炫技** — WebGL 背景只在 hero 页透出
2. **结构优于装饰** — 信息靠字号 + 字体对比 + 网格留白,不用阴影和浮动卡片
3. **图片是第一公民** — 图片要对齐正文内容区,比例稳定,只裁底部,顶部和左右完整
4. **配图只做素材** — 生成图只保留核心照片 / 图表 / UI,不要把 PPT 页脚、标题和角标画进图片里
5. **节奏靠 hero 页** — hero / non-hero 交替,才不累眼睛
6. **低性能可退场** — 按 `B` 能切换到静态模式,动态效果不能成为阅读负担
7. **术语统一** — Skills 就是 Skills,不中英混译
8. **瑞士风必须守版式** — Style B 优先还原原始 22P 版式,不要为了"多样"发明不存在的页面

## 视觉参考

- [*Monocle*](https://monocle.com) 杂志的版式
- YC Garry Tan "Thin Harness, Fat Skills"
- Massimo Vignelli / Helvetica Forever / 瑞士国际主义网格系统
- 歸藏线下分享 PPT 系列

## 贡献

Bug、排版问题、新布局需求——欢迎开 Issue 或 PR。改动请优先:

- 在 `template.html` 里补类,不要让 layouts.md 使用未定义的类
- 在 `template-swiss.html` 里补类时,同步更新 `layouts-swiss.md` 和 `swiss-layout-lock.md`
- 瑞士风新增规则后,同步更新 `scripts/validate-swiss-deck.mjs`
- 把踩过的坑写到 `checklist.md` 对应的 P0 / P1 / P2 / P3 级别
- 新主题色进 `themes.md` 并给出适合的场景

## License

MIT © 2026 [op7418](https://github.com/op7418)
