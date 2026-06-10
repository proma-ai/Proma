---
name: /ultracode
description: Proma built-in slash-command skill for Claude Code ultracode workflows. Use `/ultracode <task>` to ask Claude Code to write and run a dynamic workflow when the task benefits from durable multi-agent orchestration.
group: proma
version: "1.0.0"
---

# Ultracode Workflow

This built-in skill backs the `/ultracode` slash command in Proma Agent chat.

When the user invokes `/ultracode <task>`:

- Treat it as an explicit opt-in to Claude Code's official `ultracode` workflow mode for the supplied task.
- Ask Claude Code to write and run an appropriate dynamic workflow rather than handling the work only as a normal turn-by-turn conversation.
- Keep workflow progress in the normal tool/background-task progress UI.
- Return final workflow output in the same Agent conversation.
- Prefer workflow only when durable orchestration, fan-out, repeatability, or cross-checking materially helps the task.

If workflow support is unavailable, explain the missing capability and offer the closest lower-risk path, such as a normal plan, subagents, or a reusable Skill.
