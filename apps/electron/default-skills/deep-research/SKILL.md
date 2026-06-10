---
name: /deep-research
description: Proma built-in slash-command skill for Claude Code Deep Research. Use `/deep-research <question>` to fan out WebSearch/WebFetch research, cross-check sources, and return a cited report in the current Agent conversation. Requires WebSearch availability.
group: proma
version: "1.0.0"
---

# Deep Research

This built-in skill backs the `/deep-research` slash command in Proma Agent chat.

When the user invokes `/deep-research <question>`:

- Treat the input as Claude Code's bundled Deep Research workflow command.
- Use WebSearch/WebFetch-enabled research when available.
- Fan out across multiple angles and sources.
- Cross-check findings before reporting.
- Return a cited report in the same Agent conversation.
- Keep progress in the normal tool/background-task progress UI.

If WebSearch or workflow support is unavailable, explain the missing capability and the exact setup needed before attempting a manual substitute.
