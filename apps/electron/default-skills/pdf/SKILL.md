---
name: pdf
description: Process PDF files with a Markdown-first, least-complex route. Use this skill whenever the user asks to read, summarize, search, extract information from, convert, modify, create, or fill a PDF. For ordinary text-based PDFs, convert with Microsoft MarkItDown and work from the Markdown. Use direct reading only for a narrow, page-specific question. Escalate to OCR, structured table extraction, or PDF-editing libraries only when the request or conversion result requires it.
version: "2.0.0"
---

# PDF Workflow

Choose the least complex path that preserves the information the user needs. Do not count pages or install a broad toolchain before attempting the relevant task.

## Read and Analyze

### Default: MarkItDown

For summaries, document-wide questions, comparisons, searchable text, or a requested Markdown export, convert the PDF with Microsoft MarkItDown and use the resulting Markdown as the source of truth.

```bash
markitdown "input.pdf" -o "$OUTPUT_MD"
```

Create `$OUTPUT_MD` in a temporary or task-output directory, not next to the user's source file unless they requested a Markdown file. Read or search the Markdown in relevant chunks; summarize it rather than loading or returning the entire document by default. Preserve page markers or source locations when the converter provides them.

### Narrow Questions

For a simple question about an explicitly named page or a very short PDF, use the built-in Read tool first. Do not convert the whole document just to answer a small, local question.

## Check Conversion Quality

Before relying on converted text, inspect enough of the output to confirm that headings, reading order, tables, and the passages relevant to the request are usable.

Escalate only when conversion is empty or garbled, text appears to be missing, columns are interleaved, a needed table is inaccurate, or the user explicitly needs visual/layout fidelity. State the limitation and use the smallest suitable fallback below.

## Targeted Fallbacks

| Need | Use |
| --- | --- |
| Scanned pages or text inside images | OCR only for the affected pages. MarkItDown OCR requires an LLM client; do not configure or call a paid model without user approval. |
| Accurate table data | Use `pdfplumber` on the relevant pages and return CSV, JSON, or a Markdown table as requested. |
| Difficult multi-column or layout-heavy extraction | Use PyMuPDF4LLM only when MarkItDown output is inadequate. |
| Merge, split, rotate, encrypt, decrypt, watermark, or metadata edits | Use `pypdf`. Reopen the output to verify it is parseable and has the expected pages. |
| Fill a PDF form | Inspect existing AcroForm fields with `pypdf` first. For non-fillable forms, obtain or confirm each field's value and placement, then render and visually verify the output. |
| Create a PDF | Prefer a source format the user can review and edit, then generate the PDF with a suitable document tool. Render at least one page to verify layout before delivery. |

Do not use OCR, render every page, or extract every image unless the request needs it.

## Dependencies and Safety

`markitdown[pdf]` is the only default dependency. It requires Python 3.10 or later. If it is missing, explain that it is required and request approval before installing it in an isolated environment. Prefer `uv tool install --python 3.11 "markitdown[pdf]"` or a dedicated virtual environment; never install `markitdown[all]` or modify the user's global Python environment by default.

The current process's file permissions apply to MarkItDown. Treat untrusted paths and remote inputs carefully, and use its narrow local-file conversion interface where available.

For OCR, paid APIs, password removal, encryption, or overwriting an original PDF, clearly explain the external, security, or destructive effect and obtain confirmation before proceeding.
