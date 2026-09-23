# Proma

![image-20260909165815654](https://img.erlich.fun/personal-blog/proma/image-20260909165815654.png)



## Proma 简介



欢迎访问 https://proma.cool 查看更完整的介绍。



Proma 是一款为专业用户打造的开源通用的桌面端 Agent 产品。功能涵盖了主流 Agent 具备的所有功能，包括 

- Chat 模式
- Agent 模式
- 计划模式
- 项目分区
- 记忆能力
- 内嵌浏览器
- 内嵌终端
- 定时任务
- Agent 平行探索
- 子会话 & 主会话
- Skills / MCP / CLI 
- 远程链接支持：微信、飞书、钉钉、Slack
- 各种文件的预览和编辑能力



### 专业用户场景

并为专业用户场景增加了很多专门适配的功能，辅助 Agent 可以更顺畅地完成对专业场景的支持，以下的所有功能都是跟 Agent 打通并且丝滑适配：

- Todo：方便任务在完成一半时先记一下，后续可以直接在输入框引用继续工作；或通过 Agent 一起创办 Todo 完成日常提醒，还可以跟 macOS 的提醒事项相互同步
- 日程：方便 Agent 也可以帮助你创建和管理日程，避免重要事件在日程上的冲突，同样可以跟 Agent 协作，并且也一样跟 macOS 的日历相互同步
- Obsidian：深度集成了 Obsidian，比 Obsidian 更好的 markdown 实时编辑体验，为专业的知识管理、知识创造和研究型用户提供最丝滑的 Agent  交互体验
- 内嵌终端与浏览器：可以允许 Agent 直接登录并使用的可见终端和浏览器，丝滑应对编程场景和自动化任务等场景
- Agent 探索能力：对于专业用户来说，Agent 的回复总是充满多样性和并行性，很多时候我们并不想污染当前的上下文，并希望能充分探索其他的可能，并在必要时带回这些探索，Proma 专门设计了 Agent 探索功能来实现这一点
- 子会话 & 主会话：这是一个类似 SubAgent 的概念，但比 SubAgent 具备更干净的上文、可持续迭代的会话级交付，你可以通过子会话和父会话实现多 Agent 并行处理、深度研究、对抗性分析、连续的主会话修复 & 子会话持续审核的交互，实现更高质量的上下文获得更高质量的最终输出
- 自动 worktree 工作：对于开发者群体而言，可以快速通过 Proma 实现基于 worktree 的开发，并且在当前会话的右侧 Agent 会主动选择这个 worktree，直接查看基于 main 的 diff ，点击一次即可进入 Proma 可见终端，开发体验非常丝滑



[English README](./README.en.md)



## 下载安装

### 开源版下载

从 [GitHub Releases](https://github.com/proma-ai/Proma/releases) 下载开源版本，提供 macOS Apple Silicon、macOS Intel、Windows、Ubuntu/Debian x86_64 的 `.deb` 安装包和 Linux x86_64 AppImage。Linux 的安装、安全边界和支持范围见 [Linux 说明](./docs/linux.md)。



### 商业版下载

 [Proma 商业版](https://proma.cool/download) 提供稳定、安全、并具备竞争力的前沿模型访问能力，同时允许用户配置自己的 Codex、Kimi Coding Plan 等数十种市面主流 Coding Plan/ Agent Plan，并利用 Proma Cloud 能力大幅扩展 Proma 商业版实际的能力边界。**开源版本用户可直接下载商业版覆盖安装即可，数据均会被保留和继承**。由于我们的能力和时间太过有限，被迫只能选择降低开源版的功能更新和迭代节奏，更专注开发商业版本，欢迎体验我们的商业版。

点击下载： [Proma 商业版](https://proma.cool/download)



### 开源 vs 商业版

| 对比项             | 开源版                                                       | 商业版                                                       |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 更新和修复         | 必要的更新和修复                                             | 更快的更新节奏，及时的修复以及更新和更丝滑的功能体验         |
| 核心桌面能力       | 完整的 Proma 桌面体验，可自由配置工作流                      | 保留同样的核心桌面体验                                       |
| 模型渠道           | 自行添加和管理 AI 供应商渠道与 API Key                       | 登录后可使用 Proma 官方内置模型渠道，也仍可自行配置第三方渠道 |
| 模型价格           | 按所选供应商的规则和价格使用                                 | 精选模型提供 Proma Cloud 专属优惠，部分模型最高可低至官方参考价 1 折 |
| Agent 安全与稳定   | 需自行评估供应商的安全、协议兼容与稳定性；使用第三方中转站时也需自行判断额外的信任与数据处理风险 | 使用 Proma Cloud 官方托管链路，提供统一的安全与稳定性保障、Agent 协议兼容和模型健康监控，减少不透明第三方中转带来的不确定性 |
| 联网与内嵌 AI 能力 | 按需自行配置搜索、生图等服务及对应 API Key                   | 提供更完整的 Proma Cloud 联网与内嵌能力，包括 WebSearch，以及 GPT Image 2 生图和编辑 |
| 对外 API 与服务    | 主要使用你自行配置的供应商 API                               | 可创建独立、可设额度上限的 Proma Cloud API Key，将 LLM、工具和多模态能力接入自己的应用或服务 |
| 团队额度管理       | 需自行搭建成员、额度分配与用量管理机制                       | 团队管理员可向成员分配或回收共享团队额度，支持按月自动分配，并查看成员用量与额度流水 |
| Skills 分发与协作  | Skills 为工作区本地能力，团队内分发与共享需自行组织          | 企业版支持 Skills 的组织级分发与团队协作：管理员可将团队沉淀的 Skills 一键下发到成员，成员侧免安装直接使用，并统一管理版本、更新与使用范围 |
| 订阅与用量         | 自行管理供应商账号、余额与用量                               | 在应用内管理订阅与余额，并查看模型、Agent 和工具的用量明细   |
| 从开源版切换       | —                                                            | 直接覆盖安装即可，继续使用已有的本地 Proma 数据              |

> 可用模型、价格和权益会随时间调整，以应用内当期展示为准。



## Proma 的核心能力 & 理念

Proma 是少数为专业用户打造的 Agent 产品，尤其对于 Agent 重度用户，Proma 拥有更透明的 Agent 运行环节、更多的可见配置、更合理的项目工作分区/记忆/Skills 等分区处理、拥有更简单符合逻辑的预览和编辑体验，丰富的内嵌功能包括浏览器和终端等。



Proma 完全重构了交互体验和 UX 系统，我们认为左侧部分是会话区域的管理和部分主要功能的入口；中间都部分是 Agent 的主要输出区域，负责人和 Agent 的交互；右侧是一切的辅助区域，整个项目的文件、Agent 对文件的改动、打开不同的文档预览、查看子会话交互、使用内嵌浏览器、终端、Obsidian、日程、Todo、Skills 等等，一切都在辅助中间的 Agent 获得更好的结果。



对于今天的 Agent 和大语言模型来说，更智能的前提是更好的上下文，我们的核心工作就是帮助你组织更好的上下文。下面所有的功能都在解释这一点，也在解释 Proma 是如何站在为专业用户的角度来设计这种更好的上下文的。

![image-20260908110801716](https://img.erlich.fun/personal-blog/proma/image-20260908110801716.png)



## 功能截图

### 子会话 & 主会话

左侧是主会话，当你需要并行做深度研究，提高效率和信息密度时，或者对抗性检查等，子会话都是更好的选择，你甚至可以并行查看主会话和子会话。子会话比传统的 Subagent 有更干净的上下文，可以持续迭代和交互的环境，拥有更自由的模型选择和更好的性能。

![image-20260908112300711](https://img.erlich.fun/personal-blog/proma/image-20260908112300711.png)



### 探索模式

是探索，而不是分叉。你可以在 Agent 输出结束后点击探索按钮，探索允许你利用前序上下文的同时可以创建无限多个分叉，你可以并行利用上下文，满足一切你的研究需求或者好奇心。之所以是探索而不是分叉，当你完成这些研究后，点击探索右上角的带回到主会话按钮，可以让所有的探索都回到主线继续，这样你将会获得到更优质的主会话上下文，无需担心自己拿捏不定的判断或边缘的问题影响到主会话的上下文。

![image-20260908112614345](https://img.erlich.fun/personal-blog/proma/image-20260908112614345.png)



### 文件改动

对于很多产品来说，Agent 对所有文件的操作产生的改动都叫 Artifacts 产出物，但核心就是文件改动。Proma 的文件改动支持划分轮次显示；对于编程场景会展示 Diff；对于 worktree 的开发模式 Agent 会主动选择对应的 worktree 并在对应的 worktree 后面放一个终端按钮，你可以点击一次就进入到开发。当然，Agent 也可以操作这一切。

![image-20260908113333692](https://img.erlich.fun/personal-blog/proma/image-20260908113333692.png)



### Skills / MCP / CLI

Proma 一样支持这三种，但对于 Proma 来说，最好的 Skills 都不来自互联网和他人，它来自你的真实场景，我们推荐你可以手把手带着 Agent 做一次你真实的处理流程，然后让 Agent 沉淀成 Skills，这会是更加的方案，再通过实际的使用迭代。Proma 内嵌了一些我们认为必要的 Skills、并支持常见的 MCP 和 CLI 的一键安装。最后商业版还支持团队 Skills 的共享和迭代管理。对于 Skills 和 MCP 来说，Proma 都是分项目的，因为过多的 Skills 和 MCP 也会导致 Agent 能力的下降，按项目区分可以更好的精简这类上下文，可以自然提高 Agent 的实际表现，缺点是需要人本身的关注更多。

「连接」目录内置 AnySearch 远程 MCP，可匿名接入公开网页搜索、垂直领域查询、并行检索和网页正文提取，不需要本机 Python。另有随安装包分发的 AnySearch Skill 与 REST 客户端，适合由 Agent 直接控制参数；这一方式需要 Python 3.10+，未设置 `ANYSEARCH_API_KEY` 时匿名使用（额度较低），已有密钥可由工作区环境变量提供。查询与公开 URL 会发送给 AnySearch，敏感数据不应放进搜索词。接入与维护细节见 [`apps/electron/default-skills/anysearch/INTEGRATION.md`](apps/electron/default-skills/anysearch/INTEGRATION.md)。

![image-20260908113623429](https://img.erlich.fun/personal-blog/proma/image-20260908113623429.png)

![image-20260908113638780](https://img.erlich.fun/personal-blog/proma/image-20260908113638780.png)



### 内嵌浏览器

Proma 的内嵌浏览器可以主动地被 Agent 使用，它适合于浏览器自动化场景、补充联网搜索的不足、甚至是在一些自动化敏感的网站上做一些研究和信息对照。今天我自己的小红书有一部分就是 Proma 通过内嵌浏览器来打理的，做群聊和评价的回复，回收用户的反馈自动计入 Todo。当你开发网站时也会经常遇到 Agent 使用浏览器，这是个强大的功能，我们对完整的浏览器功能的开发可能也完全不足，推荐你来深度探索。

![image-20260908113724838](https://img.erlich.fun/personal-blog/proma/image-20260908113724838.png)



### 记忆能力

Proma  的记忆也是区分项目的，每个项目会有一个自己的 AGENTS.md 文件，这是项目层级的，核心是约束整个项目下 Agent 的表现，包括但不限于引导 Agent 项目文件的分布、交互的规则、必备的信息或者需要遵守约定的部分等。

然后是更具体的记忆，MEMORY.md 是整个记忆的索引，下面更多的部分是具体类目下的记忆。如果你已经用了一小段时间了，但是还没形成这些内容，不妨新开个会话跟 Agent 说：请帮我形成当前项目下的 AGENTS.md 文件，并探索最近半个月或者一个月的会话来形成一些关于我和项目的记忆。

![image-20260908114118777](https://img.erlich.fun/personal-blog/proma/image-20260908114118777.png)



### 文件预览和编辑

Proma 支持主流的文件预览和编辑，比如 markdown，我们采用了 Live Markdown 方案，你可以像在 Typora 或者 Obsidian 里类似的编辑体验，简约实用。并且也支持 PDF、Docx、PPT、Excel 等文档的预览。你不但可以预览，还可以划线这些部分，多次的跟 Agent 对具体的部分进行描述，甚至你还可以打开问答，快速获得一些简单问题的答案。

![image-20260908114657248](https://img.erlich.fun/personal-blog/proma/image-20260908114657248.png)



### 项目、项目文件/会话、会话文件

对于 Proma 来说，好的上下文是一定要区分好项目和项目文件的，对于一类工作，你可能需要创建不同的项目，并在对应的项目文件下添加这些项目可能会用到的文件，或者你也可以直接在已经存在的文件夹下创建项目，然后跟 Agent 一起形成一份 AGENTS.md 文件用于对这个项目的引导。

会话是每次你新建的一个对话框，一个会话只负责处理一个具体的小任务，对于任务本身的分割仍然是几天 Agent 使用者的核心工作；对于当前小任务而言你会用到的一次性的参考文件和内容，最好是添加在会话文件夹下，你拖动进输入框的一切都会进入到会话文件夹下。

如果你担心新建会话会导致 Agent 并不知晓你正在做什么工作，你需要上一份会话的记忆？那么最好的方式是逐渐养成习惯，把这些“记忆”合适地转换成这个项目下的 AGENTS.md、记忆、Skills 以及文档等。当然，你也可以偷懒直接把上个会话从左侧拖到输入框实现引用，也可以输入 & 来引用，这都可以。

哦对了，说到拖动，你想引用具体的文件告知 Agent 时，如果它已经存在在当前的项目或者会话文件夹下了，也可以直接从右侧拖过来，然后简单补充几句话即可，或者你更擅长用 @ 也可以引用。

![image-20260908114818028](https://img.erlich.fun/personal-blog/proma/image-20260908114818028.png)



### 定时任务

定时任务均可以由 Agent 来为你创建和迭代，越是日程的工作，越有可能会成为定时任务。我们的定时任务不但支持单次运行，还支持间隔一定时间执行，甚至支持工作日上午的十点到十二点，每二十分钟一次这样的复杂要求。

![image-20260908112055273](https://img.erlich.fun/personal-blog/proma/image-20260908112055273.png)



### 内嵌的日程和 Todo

所有的日程和 Todo 均可以通过 Agent 进行操作，也可以人工编辑，Agent 不但可以帮助你记录这些，还可以在合适的时候知晓你的安排并帮助你安排工作，这时候可能语音输入更适合，Proma 也内嵌语音输入

![image-20260908111504034](https://img.erlich.fun/personal-blog/proma/image-20260908111504034.png)

![image-20260908111521550](https://img.erlich.fun/personal-blog/proma/image-20260908111521550.png)



### Obsidian

我们写了一个建议的 Obsidian 样式的 markdown 编辑器，这样可以更好的组织个人的知识以及 Agent 生产的知识，还可以顺手记录或者创作，打开 Obsidian 一样可以进行管理和编辑。

![image-20260908111956671](https://img.erlich.fun/personal-blog/proma/image-20260908111956671.png)



## 贡献

欢迎修 Bug、补文档、加测试、完善体验，也欢迎围绕真实场景提交新的 Skills、MCP 配置或 Agent 工作流。

提交 PR 前建议先确认：

- 使用 Bun 运行脚本，不混用 npm / pnpm lockfile。
- 状态管理使用 Jotai。
- 尽量保持本地优先，优先使用配置文件和 JSON / JSONL。
- TypeScript 不使用 `any`，对象结构优先使用 `interface`。
- 新增 IPC 时同步修改 shared 类型、main handler、preload bridge 和 renderer 调用。
- 影响包行为时递增对应 package 的 patch 版本。
- 能用测试覆盖的行为尽量补上测试，尤其是共享逻辑、IPC 契约和持久化格式。

## 作者

- 个人网站：[erlich.fun](https://erlich.fun)

## Star History

<a href="https://www.star-history.com/?repos=proma-ai%2Fproma&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=proma-ai/proma&type=date&theme=dark&legend=top-left&sealed_token=0cHFGjNPPe5hd2uxpF1cy35N2kYGSIEnTvyIbHlGjkrrtH9rnKcBMkqA8wDWltJIlPRKFZoYyPjXItri9HhQXE1TM1rwdIe91fqTqXVcPwK6OMzGEJ9yNw" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=proma-ai/proma&type=date&legend=top-left&sealed_token=0cHFGjNPPe5hd2uxpF1cy35N2kYGSIEnTvyIbHlGjkrrtH9rnKcBMkqA8wDWltJIlPRKFZoYyPjXItri9HhQXE1TM1rwdIe91fqTqXVcPwK6OMzGEJ9yNw" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=proma-ai/proma&type=date&legend=top-left&sealed_token=0cHFGjNPPe5hd2uxpF1cy35N2kYGSIEnTvyIbHlGjkrrtH9rnKcBMkqA8wDWltJIlPRKFZoYyPjXItri9HhQXE1TM1rwdIe91fqTqXVcPwK6OMzGEJ9yNw" />
 </picture>
</a>

## 许可证

Proma 社区版采用 [GNU Affero General Public License v3.0（AGPL-3.0）](./LICENSE) 开源，完整条款见根目录 `LICENSE` 文件。

**个人 / 非商业使用**：自由使用、修改、分发，仅需遵守 AGPL-3.0 条款。

**商业使用**：在完全遵守 AGPL-3.0 条款的前提下允许进行商业使用，包括但不限于：以源代码或修改后的形式分发软件、通过网络对外提供服务时必须公开完整修改源码（含网络交互层）、衍生作品须以 AGPL-3.0 继续授权。

**商业授权（豁免 AGPL-3.0 义务）**：如果你希望将 Proma 集成到闭源产品、对外提供 SaaS 服务但不想公开衍生代码，或有其他无法满足 AGPL-3.0 条款的商业场景，请通过邮件联系获取商业许可：[erlichliu@gmail.com](mailto:erlichliu@gmail.com)。

向本项目提交 Pull Request 即视为同意将贡献以 AGPL-3.0 及未来商业许可形式授权给项目维护者。
