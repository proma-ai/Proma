#!/usr/bin/env python3
"""clean_session.py - 清洗 Proma 会话 JSONL 为可读 Markdown 对话

将 ~/.proma/agent-sessions/<id>.jsonl 里流式传输产生的拼接单字和冗余快照
过滤为干净对话,输出 Markdown(.md)。自动识别两种会话格式:
  - 格式 B(SDK 流式):顶层含 type + message,assistant 按 message.id 分组
  - 格式 A(旧扁平):顶层含 role + string content

用法:
    python clean_session.py <session_id 或 .jsonl 路径>
    python clean_session.py <session_id> --out cleaned/
    python clean_session.py --all --out cleaned/
"""
from __future__ import annotations
import argparse
import json
import sys
from collections import OrderedDict
from pathlib import Path
from typing import Any

SESSIONS_DEFAULT = Path.home() / ".proma" / "agent-sessions"


# ---------------------------------------------------------------------------
# 格式探测
# ---------------------------------------------------------------------------

def detect_format(row: dict) -> str:
    if "type" in row and "message" in row:
        return "B"
    if "role" in row and isinstance(row.get("content"), str):
        return "A"
    return "unknown"


# ---------------------------------------------------------------------------
# 格式 A:扁平 chat 行
# ---------------------------------------------------------------------------

def parse_format_a(rows: list[dict]) -> list[dict]:
    """返回 [{role, text, ts}, ...],顺序保留、去重相邻相同 user 与空 assistant。"""
    dialogue: list[dict] = []
    last_user_text: str | None = None
    for r in rows:
        role = r.get("role")
        text = (r.get("content") or "").strip()
        ts = r.get("createdAt")
        if role == "user":
            if text and text != last_user_text:
                dialogue.append({"role": "user", "text": text, "ts": ts})
                last_user_text = text
        elif role == "assistant":
            if text:
                dialogue.append({"role": "assistant", "text": text, "ts": ts})
                last_user_text = None
    return dialogue


# ---------------------------------------------------------------------------
# 格式 B:SDK 流式快照
# ---------------------------------------------------------------------------

def _merge_b_user(rows: list[dict]) -> list[dict]:
    """把 user 行的 content[] 拆成 user 文本条目(丢 tool_result)。"""
    items: list[dict] = []
    for r in rows:
        msg = r.get("message") if isinstance(r.get("message"), dict) else {}
        content = msg.get("content", [])
        if isinstance(content, str):
            text = content.strip()
            if text:
                items.append({"role": "user", "text": text, "ts": r.get("_createdAt")})
            continue
        for blk in content:
            if not isinstance(blk, dict):
                continue
            if blk.get("type") == "text":
                text = (blk.get("text") or "").strip()
                if text:
                    items.append({"role": "user", "text": text, "ts": r.get("_createdAt")})
    return items


def _summarize_tool_input(name: str, inp: dict | None) -> str:
    """把工具 input 压缩成可读单行摘要。"""
    if not inp:
        return name
    parts: list[str] = []
    for k, v in inp.items():
        if v is None or v == "" or v == [] or v == {}:
            continue
        sv = str(v)
        if len(sv) > 80:
            sv = sv[:77] + "..."
        parts.append(f"{k}={sv}")
    return f"{name} " + " ".join(parts)


def _merge_b_assistant(rows: list[dict]) -> list[dict]:
    """
    把同一 message.id 的多个快照行合并为单一 assistant 回合。

    策略:取最后一行(最完整快照)的 content 数组作为最终内容;
    若最后一行缺失 tool_use/text 块,从早期快照补回(防边缘情况丢失)。
    thinking 块全部丢弃;tool_use 压缩为摘要行;text 保留原文。
    """
    if not rows:
        return []
    last = rows[-1]
    last_msg = last.get("message") if isinstance(last.get("message"), dict) else {}
    last_content: list[dict] = list(last_msg.get("content", [])) if isinstance(last_msg.get("content"), list) else []

    # 收集所有快照里的 tool_use id 与 text 块(按出现顺序),用于补全
    all_tool_uses: "OrderedDict[str, dict]" = OrderedDict()
    all_texts: list[str] = []
    for r in rows:
        r_msg = r.get("message") if isinstance(r.get("message"), dict) else {}
        for blk in r_msg.get("content", []) if isinstance(r_msg.get("content"), list) else []:
            if not isinstance(blk, dict):
                continue
            if blk.get("type") == "tool_use" and blk.get("id"):
                all_tool_uses.setdefault(blk["id"], blk)
            elif blk.get("type") == "text":
                t = blk.get("text") or ""
                # 保留最长(快照越晚越长)
                if not all_texts or len(t) > len(all_texts[-1]):
                    all_texts.append(t)

    # 构建最终块序列:基于最后一行,缺失则补
    seen_tool_ids = {
        b.get("id") for b in last_content if isinstance(b, dict) and b.get("type") == "tool_use"
    }
    final_blocks: list[dict] = []
    for blk in last_content:
        if not isinstance(blk, dict):
            continue
        if blk.get("type") == "thinking":
            continue
        final_blocks.append(blk)

    # 早期快照里有但最后一行没出现的 tool_use,按原始顺序追加
    for tid, blk in all_tool_uses.items():
        if tid not in seen_tool_ids:
            final_blocks.append(blk)
            seen_tool_ids.add(tid)

    # 输出 dialogue 条目
    items: list[dict] = []
    ts = last.get("_createdAt")
    for blk in final_blocks:
        btype = blk.get("type")
        if btype == "text":
            text = (blk.get("text") or "").strip()
            if text:
                items.append({"role": "assistant", "text": text, "ts": ts})
        elif btype == "tool_use":
            name = blk.get("name", "tool")
            summary = _summarize_tool_input(name, blk.get("input"))
            items.append({"role": "assistant_tool", "text": summary, "ts": ts})
    return items


def collapse_consecutive_tools(dialogue: list[dict]) -> list[dict]:
    """
    把连续相同的 assistant_tool 条目折叠为一条,末尾加 ×N 计数。
    例: 445 次相同 OCR 调用 → 一行 "> [工具: ... ×445]"。
    """
    if not dialogue:
        return dialogue
    out: list[dict] = []
    i = 0
    while i < len(dialogue):
        item = dialogue[i]
        if item["role"] != "assistant_tool":
            out.append(item)
            i += 1
            continue
        j = i + 1
        while j < len(dialogue) and dialogue[j]["role"] == "assistant_tool" and dialogue[j]["text"] == item["text"]:
            j += 1
        count = j - i
        if count == 1:
            out.append(item)
        else:
            out.append({**item, "text": f"{item['text']} ×{count}"})
        i = j
    return out


def parse_format_b(rows: list[dict]) -> list[dict]:
    """按时间顺序把格式 B 行组织成对话条目(user / assistant / assistant_tool)。"""
    # 按 message.id 聚合 assistant 行,保留首次出现顺序
    assistant_groups: "OrderedDict[str, list[dict]]" = OrderedDict()
    non_assistant: list[tuple[int, dict]] = []

    for i, r in enumerate(rows):
        t = r.get("type")
        if t == "assistant":
            r_msg = r.get("message") if isinstance(r.get("message"), dict) else {}
            mid = r_msg.get("id") or f"_no_id_{i}"
            assistant_groups.setdefault(mid, []).append(r)
        elif t in ("user", "result", "system"):
            non_assistant.append((i, r))

    # 按原始行号交叉 user 行和 assistant 组
    dialogue: list[dict] = []
    # 构建 (first_line_index, payload) 的有序列表
    events: list[tuple[int, Any]] = []
    for i, r in non_assistant:
        events.append((i, ("user_row", r)))
    for mid, group in assistant_groups.items():
        first_idx = rows.index(group[0])
        events.append((first_idx, ("assistant_group", group)))
    events.sort(key=lambda e: e[0])

    for _, payload in events:
        kind, data = payload
        if kind == "user_row":
            # 跳过纯 tool_result 的 user 行(无 text 块),那是工具回包不是真用户发言
            items = _merge_b_user([data])
            if items:
                dialogue.extend(items)
        else:
            dialogue.extend(_merge_b_assistant(data))
    return dialogue


# ---------------------------------------------------------------------------
# Markdown 渲染
# ---------------------------------------------------------------------------

def render_markdown(dialogue: list[dict], session_id: str) -> str:
    lines: list[str] = []
    lines.append(f"# Session: {session_id}\n")
    lines.append(f"> 自动清洗自 `{session_id}.jsonl`,流式快照与工具回包已过滤。\n")
    lines.append("")

    current_role: str | None = None
    for item in dialogue:
        role = item["role"]
        text = item["text"]
        if role == "user":
            if current_role != "user":
                lines.append("## 用户\n")
                current_role = "user"
            lines.append(text)
            lines.append("")
        elif role == "assistant":
            if current_role != "assistant":
                lines.append("## 助手\n")
                current_role = "assistant"
            lines.append(text)
            lines.append("")
        elif role == "assistant_tool":
            if current_role != "assistant":
                lines.append("## 助手\n")
                current_role = "assistant"
            lines.append(f"> [工具: {text}]")
            lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 顶层清洗
# ---------------------------------------------------------------------------

def clean_one(input_path: Path) -> tuple[str, str]:
    """读取一个 JSONL,返回 (session_id, markdown_content)。"""
    session_id = input_path.stem
    with input_path.open("r", encoding="utf-8") as f:
        raw_rows: list[dict] = []
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                raw_rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # 容错:跳过损坏行

    if not raw_rows:
        return session_id, f"# Session: {session_id}\n\n> 会话为空或无法解析。\n"

    fmt = detect_format(raw_rows[0])
    if fmt == "A":
        dialogue = parse_format_a(raw_rows)
    elif fmt == "B":
        dialogue = parse_format_b(raw_rows)
    else:
        return session_id, (
            f"# Session: {session_id}\n\n> 无法识别会话格式,首行:\n\n```json\n"
            + json.dumps(raw_rows[0], ensure_ascii=False, indent=2)
            + "\n```\n"
        )

    return session_id, render_markdown(collapse_consecutive_tools(dialogue), session_id)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="清洗 Proma 会话 JSONL 为干净 Markdown 对话"
    )
    p.add_argument(
        "target",
        nargs="?",
        help="会话 ID 或 .jsonl 文件路径(与 --all 互斥)",
    )
    p.add_argument("--all", action="store_true", help="批量清洗 sessions-dir 下所有 .jsonl")
    p.add_argument(
        "--sessions-dir",
        type=Path,
        default=SESSIONS_DEFAULT,
        help=f"会话目录(默认 {SESSIONS_DEFAULT})",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=Path("cleaned"),
        help="输出目录(默认 ./cleaned)",
    )
    p.add_argument(
        "--stdout",
        action="store_true",
        help="不写文件,直接输出到 stdout",
    )
    args = p.parse_args(argv)

    if args.all and args.target:
        p.error("--all 与 target 不能同时使用")
    if not args.all and not args.target:
        p.error("请提供 session id/路径,或加 --all")

    inputs: list[Path] = []
    if args.all:
        if not args.sessions_dir.is_dir():
            print(f"错误:sessions 目录不存在 {args.sessions_dir}", file=sys.stderr)
            return 2
        inputs = sorted(args.sessions_dir.glob("*.jsonl"))
        if not inputs:
            print(f"错误:sessions 目录下没有 .jsonl {args.sessions_dir}", file=sys.stderr)
            return 2
    else:
        target = Path(args.target)
        if target.is_file():
            inputs = [target]
        else:
            candidate = args.sessions_dir / f"{target}.jsonl"
            if candidate.is_file():
                inputs = [candidate]
            else:
                candidate2 = args.sessions_dir / f"{args.target}.jsonl"
                if candidate2.is_file():
                    inputs = [candidate2]
                else:
                    print(
                        f"错误:找不到会话文件 {args.target}(已尝试 {target} 与 {candidate})",
                        file=sys.stderr,
                    )
                    return 2

    if not args.stdout:
        args.out.mkdir(parents=True, exist_ok=True)

    ok = 0
    for path in inputs:
        try:
            sid, md = clean_one(path)
        except Exception as e:
            print(f"[fail] {path.name}: {e}", file=sys.stderr)
            continue
        if args.stdout:
            sys.stdout.write(md)
            if len(inputs) > 1:
                sys.stdout.write("\n\n---\n\n")
        else:
            out_path = args.out / f"{sid}.clean.md"
            out_path.write_text(md, encoding="utf-8")
            print(f"[ok]   {path.name} -> {out_path}")
        ok += 1

    print(f"\n完成: {ok}/{len(inputs)} 个会话已清洗", file=sys.stderr)
    return 0 if ok == len(inputs) else 1


if __name__ == "__main__":
    raise SystemExit(main())
