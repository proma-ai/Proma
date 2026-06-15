---
name: pdf
description: Use this skill whenever the user mentions a PDF file or asks to produce/edit one. For read-only tasks such as reading, summarizing, extracting plain text, or answering questions from a PDF, follow this skill's read-only routing rules: use the built-in Read tool first, do not write code or scripts, and prefer markitdown for PDFs over 100 pages. Use PDF processing libraries/scripts only for modification tasks such as merging, splitting, rotating, watermarking, filling forms, encrypting/decrypting, extracting images, OCR, or creating PDFs.
license: Proprietary. LICENSE.txt has complete terms
version: "1.0.4"
---

# PDF Processing Guide

## Overview

This guide defines how to handle PDF files. Read-only tasks must be handled with built-in tools first. Python libraries and scripts are fallback tools for PDF modification, OCR, form filling, or other operations that cannot be completed by direct reading.

## Read-Only Routing Rules

Use this section for requests like "read this PDF", "summarize this PDF", "answer questions from this PDF", or "extract the main points".

1. Prefer the built-in Read tool on the PDF path.
   - Do not write Python, JavaScript, shell scripts, or temporary extraction files for simple reading.
   - Do not use the Python examples below for read-only tasks unless the built-in Read tool fails or the user explicitly asks for a generated file.

2. If the PDF has more than 100 pages, prefer markitdown before Python libraries.
   - First check whether a global `markitdown` command is available.
   - If global `markitdown` exists, use it directly.
   - If global `markitdown` is missing, install it globally for the user, then use it.
   - Do not create wrapper scripts around markitdown.
   - If installation fails because of network, permissions, or missing Python tooling, say so briefly and fall back to the built-in Read tool or ask which page range to inspect.

3. Only move to PDF processing libraries or scripts when the task needs document transformation, complex table extraction, OCR, form filling, image extraction, or PDF generation.

### Page Count Check

Use the cheapest available command. Try `pdfinfo` first:

```bash
pdfinfo input.pdf | grep '^Pages:'
```

If `pdfinfo` is unavailable, use the built-in Read tool and infer whether the document is long from the tool result. Avoid writing a custom page-count script just to decide the reading path.

### markitdown for Long PDFs

For PDFs over 100 pages, first check for a globally available markitdown command:

```bash
command -v markitdown
```

If it exists, convert to Markdown directly:

```bash
markitdown input.pdf
```

If `markitdown` is not installed, install it globally before converting. Prefer direct `pip` installation because it is usually faster and has fewer network/toolchain dependencies than Homebrew-based flows.

Before installing, quickly verify the package source/version if tooling is available:

```bash
python3 -m pip index versions markitdown
```

Then install:

```bash
python3 -m pip install --user "markitdown[all]"
```

After installation, run `markitdown input.pdf`. If the command is not on PATH, try `python3 -m markitdown input.pdf` or use the user's Python user-base bin path.

If the output is too long for the response, inspect or summarize relevant sections instead of dumping the full text. When saving a converted Markdown file is useful, ask only if the user did not already request a file output.

## Modification and Advanced Processing

Use the sections below when the user asks to modify PDFs, create PDFs, fill forms, extract images, OCR scanned pages, or perform precise table extraction that the built-in Read tool cannot handle.

## Python Libraries

### pypdf - Basic Operations

#### Merge PDFs
```python
from pypdf import PdfWriter, PdfReader

writer = PdfWriter()
for pdf_file in ["doc1.pdf", "doc2.pdf", "doc3.pdf"]:
    reader = PdfReader(pdf_file)
    for page in reader.pages:
        writer.add_page(page)

with open("merged.pdf", "wb") as output:
    writer.write(output)
```

#### Split PDF
```python
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as output:
        writer.write(output)
```

#### Extract Metadata
```python
reader = PdfReader("document.pdf")
meta = reader.metadata
print(f"Title: {meta.title}")
print(f"Author: {meta.author}")
print(f"Subject: {meta.subject}")
print(f"Creator: {meta.creator}")
```

#### Rotate Pages
```python
reader = PdfReader("input.pdf")
writer = PdfWriter()

page = reader.pages[0]
page.rotate(90)  # Rotate 90 degrees clockwise
writer.add_page(page)

with open("rotated.pdf", "wb") as output:
    writer.write(output)
```

### pdfplumber - Text and Table Extraction

#### Extract Text with Layout
```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        print(text)
```

#### Extract Tables
```python
with pdfplumber.open("document.pdf") as pdf:
    for i, page in enumerate(pdf.pages):
        tables = page.extract_tables()
        for j, table in enumerate(tables):
            print(f"Table {j+1} on page {i+1}:")
            for row in table:
                print(row)
```

#### Advanced Table Extraction
```python
import pandas as pd

with pdfplumber.open("document.pdf") as pdf:
    all_tables = []
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables:
            if table:  # Check if table is not empty
                df = pd.DataFrame(table[1:], columns=table[0])
                all_tables.append(df)

# Combine all tables
if all_tables:
    combined_df = pd.concat(all_tables, ignore_index=True)
    combined_df.to_excel("extracted_tables.xlsx", index=False)
```

### reportlab - Create PDFs

#### Basic PDF Creation
```python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

c = canvas.Canvas("hello.pdf", pagesize=letter)
width, height = letter

# Add text
c.drawString(100, height - 100, "Hello World!")
c.drawString(100, height - 120, "This is a PDF created with reportlab")

# Add a line
c.line(100, height - 140, 400, height - 140)

# Save
c.save()
```

#### Create PDF with Multiple Pages
```python
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet

doc = SimpleDocTemplate("report.pdf", pagesize=letter)
styles = getSampleStyleSheet()
story = []

# Add content
title = Paragraph("Report Title", styles['Title'])
story.append(title)
story.append(Spacer(1, 12))

body = Paragraph("This is the body of the report. " * 20, styles['Normal'])
story.append(body)
story.append(PageBreak())

# Page 2
story.append(Paragraph("Page 2", styles['Heading1']))
story.append(Paragraph("Content for page 2", styles['Normal']))

# Build PDF
doc.build(story)
```

#### Subscripts and Superscripts

**IMPORTANT**: Never use Unicode subscript/superscript characters (₀₁₂₃₄₅₆₇₈₉, ⁰¹²³⁴⁵⁶⁷⁸⁹) in ReportLab PDFs. The built-in fonts do not include these glyphs, causing them to render as solid black boxes.

Instead, use ReportLab's XML markup tags in Paragraph objects:
```python
from reportlab.platypus import Paragraph
from reportlab.lib.styles import getSampleStyleSheet

styles = getSampleStyleSheet()

# Subscripts: use <sub> tag
chemical = Paragraph("H<sub>2</sub>O", styles['Normal'])

# Superscripts: use <super> tag
squared = Paragraph("x<super>2</super> + y<super>2</super>", styles['Normal'])
```

For canvas-drawn text (not Paragraph objects), manually adjust font the size and position rather than using Unicode subscripts/superscripts.

## Command-Line Tools

### pdftotext (poppler-utils)
```bash
# Extract text
pdftotext input.pdf output.txt

# Extract text preserving layout
pdftotext -layout input.pdf output.txt

# Extract specific pages
pdftotext -f 1 -l 5 input.pdf output.txt  # Pages 1-5
```

### qpdf
```bash
# Merge PDFs
qpdf --empty --pages file1.pdf file2.pdf -- merged.pdf

# Split pages
qpdf input.pdf --pages . 1-5 -- pages1-5.pdf
qpdf input.pdf --pages . 6-10 -- pages6-10.pdf

# Rotate pages
qpdf input.pdf output.pdf --rotate=+90:1  # Rotate page 1 by 90 degrees

# Remove password
qpdf --password=mypassword --decrypt encrypted.pdf decrypted.pdf
```

### pdftk (if available)
```bash
# Merge
pdftk file1.pdf file2.pdf cat output merged.pdf

# Split
pdftk input.pdf burst

# Rotate
pdftk input.pdf rotate 1east output rotated.pdf
```

## Common Tasks

### Extract Text from Scanned PDFs
```python
# Requires: pip install pytesseract pdf2image
import pytesseract
from pdf2image import convert_from_path

# Convert PDF to images
images = convert_from_path('scanned.pdf')

# OCR each page
text = ""
for i, image in enumerate(images):
    text += f"Page {i+1}:\n"
    text += pytesseract.image_to_string(image)
    text += "\n\n"

print(text)
```

### Add Watermark
```python
from pypdf import PdfReader, PdfWriter

# Create watermark (or load existing)
watermark = PdfReader("watermark.pdf").pages[0]

# Apply to all pages
reader = PdfReader("document.pdf")
writer = PdfWriter()

for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)

with open("watermarked.pdf", "wb") as output:
    writer.write(output)
```

### Extract Images
```bash
# Using pdfimages (poppler-utils)
pdfimages -j input.pdf output_prefix

# This extracts all images as output_prefix-000.jpg, output_prefix-001.jpg, etc.
```

### Password Protection
```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("input.pdf")
writer = PdfWriter()

for page in reader.pages:
    writer.add_page(page)

# Add password
writer.encrypt("userpassword", "ownerpassword")

with open("encrypted.pdf", "wb") as output:
    writer.write(output)
```

## Quick Reference

| Task | Best Tool | Command/Code |
|------|-----------|--------------|
| Merge PDFs | pypdf | `writer.add_page(page)` |
| Split PDFs | pypdf | One page per file |
| Read or summarize PDFs | Built-in Read tool | Use Read first; no scripts |
| Long PDF text extraction (>100 pages) | markitdown | `markitdown input.pdf` |
| Extract text after Read fails | pdfplumber | `page.extract_text()` |
| Extract tables after Read fails | pdfplumber | `page.extract_tables()` |
| Create PDFs | reportlab | Canvas or Platypus |
| Command line merge | qpdf | `qpdf --empty --pages ...` |
| OCR scanned PDFs | pytesseract | Convert to image first |
| Fill PDF forms | pdf-lib or pypdf (see FORMS.md) | See FORMS.md |

## Next Steps

- For advanced pypdfium2 usage, see REFERENCE.md
- For JavaScript libraries (pdf-lib), see REFERENCE.md
- If you need to fill out a PDF form, follow the instructions in FORMS.md
- For troubleshooting guides, see REFERENCE.md
