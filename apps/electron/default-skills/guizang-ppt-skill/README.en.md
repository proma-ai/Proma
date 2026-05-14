# Guizang PPT Skill · Web Decks / Images / Covers

An agent skill for Claude Code, Codex, and similar coding-agent environments. It generates **single-file HTML horizontal-swipe decks**, deck visuals, and social cover pages.

It ships with two visual systems:

- **Style A: editorial magazine × electronic ink**. Picture *Monocle* with code stitched in. Best for narrative talks, opinions, salons, and personal voice.
- **Style B: Swiss International Typographic Style**. Grid-first, one high-saturation anchor color, sharp rectangles, hairline rules, and extreme type contrast. Best for facts, products, analysis, and frameworks.

> Distilled by [Guizang](https://x.com/op7418) from offline talks like "One-Person Company: Organizations Folded by AI" and "A New Way of Working." Every pitfall hit during those decks is logged in `checklist.md`.

**Old Theme · Style A Editorial Magazine**

![Style A Editorial Magazine preview](https://github.com/user-attachments/assets/5dc316a2-401c-4e37-9123-ea081b6ae470)

**New Theme · Style B Swiss International**

![Style B Swiss International preview](https://github.com/user-attachments/assets/8960e78c-69bb-4b7e-aa95-6fad64b70314)

## What you get

- 🖋 **Two visual systems**: editorial storytelling for Style A, factual Swiss structure for Style B
- 📐 **Horizontal swipe navigation**: ← → arrows / scroll wheel / touch swipe / bottom dots / ESC for index
- 🧩 **Style A 10 layouts**: cover, divider, big numbers, image/text, image grid, pipeline, comparison, and more
- 🧱 **Style B 22 locked layouts**: Cover, Statement, KPI Tower, Loop Diagram, Duo Compare, Image Hero, Closing Manifesto, and more
- 🎨 **Curated theme presets**: 5 electronic-ink themes for Style A, 4 Swiss anchor-color themes for Style B
- 🖼 **Optional Codex image flow**: generate documentary photos, infographics, flow diagrams, system maps, and UI scenes with GPT-Image 2.0 / GPT-M 2.0, then insert them at template-safe ratios
- 📰 **Social covers**: generate 21:9 WeChat cover images, 1:1 share cards, 3:4 Xiaohongshu covers, video thumbnails, and related variants
- 📴 **Low-power static mode**: press `B` to turn WebGL / canvas animation into static visuals
- 📄 **Single HTML file** — no build, no server, open directly in the browser

## Fits / Doesn't fit

**✅ Fits**: offline talks, industry keynotes, private salons, AI product launches, demo day, presentations with strong personal voice

**❌ Doesn't fit**: data-heavy tables, training decks (density too low), multi-user collaborative editing (static HTML)

## Install

### Option 1: One-line install (recommended)

```bash
npx skills add https://github.com/op7418/guizang-ppt-skill --skill guizang-ppt-skill
```

### Option 2: Paste this to an AI

> Install the `guizang-ppt-skill` Claude Code skill for me. Steps:
>
> 1. Make sure `~/.claude/skills/` exists (create if not)
> 2. Run `git clone https://github.com/op7418/guizang-ppt-skill.git ~/.claude/skills/guizang-ppt-skill`
> 3. Verify: `ls ~/.claude/skills/guizang-ppt-skill/` should show `SKILL.md`, `assets/`, `references/`
> 4. Tell me when done. Later, saying things like "make me a magazine-style deck" will trigger this skill.

Paste the block above into Claude Code / Cursor / any AI agent with shell access and it handles the install.

### Option 3: Manual CLI

```bash
git clone https://github.com/op7418/guizang-ppt-skill.git ~/.claude/skills/guizang-ppt-skill
```

### How to trigger it

Once installed, Claude Code auto-detects the skill. Trigger phrases:

- "Make me a magazine-style deck"
- "Make me a Swiss-style deck"
- "Generate a horizontal swipe deck"
- "Editorial magazine style presentation"
- "Electronic ink slides for my talk"
- "Create a 21:9 WeChat cover from this article"
- "Create a 1:1 share card from this deck"

## Workflow

The skill is a structured workflow; the agent walks you through each step:

1. **Choose style** — Style A editorial magazine, or Style B Swiss International
2. **Clarify intent** — 6-question checklist: audience, duration, source material, images, theme, hard constraints
3. **Copy template** — Style A uses `assets/template.html`; Style B uses `assets/template-swiss.html`
4. **Fill content** — create a rhythm plan, then choose and adapt the matching layout skeletons
5. **Optional image generation** — in Codex, ask whether to use GPT-Image 2.0 / GPT-M 2.0 images, then insert them at page-appropriate ratios
6. **Self-check** — match against `references/checklist.md`; P0 issues must all pass; Swiss decks must also pass the layout validator
7. **Preview** — open the HTML in a browser
8. **Iterate** — use inline styles to tune font size, height, spacing

Full spec in [`SKILL.md`](./SKILL.md).

## Style B Swiss

The Swiss theme is a strict layout system, not just a CSS skin.

- **22 named layouts**: body slides must use `S01` to `S22`; do not invent new structures
- **4 anchor colors**: International Klein Blue, lemon yellow, lemon green, safety orange
- **Grid lock**: 16-column grid, sharp rectangles, 1px hairlines, no shadows, no gradients, no rounded cards
- **Chinese title scaling**: all-Chinese headlines should be one step smaller to preserve space for content and images
- **Image/text bottom alignment**: text and image blocks should align at the bottom in left/right image layouts, while staying clear of pagination controls
- **Image slots**: images must sit in template-defined `data-image-slot` regions, often generated at 21:9 or 16:10
- **Hard validation**: the validator catches centered body titles, experimental layouts, visible SVG text, and images placed outside slots

Swiss validation:

```bash
node scripts/validate-swiss-deck.mjs path/to/index.html
```

## Codex Image Flow

In Codex, after the first deck draft is ready, the agent can ask whether the user wants generated visuals. Once confirmed, choose an image type or style. Common types include:

- Documentary photos: Fuji / Leica-like real-world scenes that add human texture
- Infographics / flow diagrams / comparison charts / system maps: for concepts that cannot be explained well with photos
- Screenshot redesigns / UI scenes: reshape raw screenshots into consistent slide-friendly ratios and visual density
- Data posters / charts: turn key numbers into insert-ready visual assets
- Multi-image compositions: useful for ultra-wide slots where three unrelated 16:9 images would break the grid

Generated images must follow three core rules:

- Treat the image as an embedded asset, not a standalone slide: no footer, page bottom, title, page number, corner mark, signature, or decorative border
- Match the deck language: Chinese decks use Chinese labels inside infographics, English decks use English labels
- Match the slot ratio before generation: 21:9 for many Swiss hero slots, 16:9 / 16:10 for common main visuals, 16:10 for UI scenes, fixed equal heights for image grids

Image prompts live in [`references/image-prompts.md`](./references/image-prompts.md).

## Cover Generation

The skill can also turn an article or deck idea into platform covers:

- **WeChat main cover**: 21:9, headline-first, with one visual anchor
- **WeChat share card**: 1:1, visually paired with the 21:9 cover
- **Xiaohongshu cover / carousel**: 3:4, large title, consistent type scale across a batch
- **Video thumbnail**: 16:9, title + subtitle + one focal visual

The same rule applies: use a few strong keywords, keep the title as the visual center, and do not fill the canvas with body copy.

## Directory

```
guizang-ppt-skill/
├── SKILL.md              ← main skill file: workflow, principles, common mistakes
├── README.md             ← Chinese README
├── README.en.md          ← this file
├── assets/
│   ├── template.html         ← Style A editorial magazine template
│   └── template-swiss.html   ← Style B Swiss template
├── scripts/
│   └── validate-swiss-deck.mjs ← Swiss layout validator
└── references/
    ├── components.md     ← component catalog (type, color, grid, icons, callout, stat, pipeline)
    ├── layouts.md        ← 10 layout skeletons (paste-ready)
    ├── layouts-swiss.md  ← 22 locked Swiss layouts
    ├── swiss-layout-lock.md ← Swiss fidelity and layout hard rules
    ├── themes.md         ← 5 theme presets (pick, don't customize)
    ├── themes-swiss.md   ← 4 Swiss anchor-color themes
    ├── image-prompts.md  ← GPT-Image 2.0 / GPT-M 2.0 image types, ratios, and base prompts
    └── checklist.md      ← quality checklist (P0 / P1 / P2 / P3 tiers)
```

## Theme presets

Pick from `references/themes.md`. **Custom hex values are not allowed** — protecting the aesthetic matters more than freedom of choice.

| Theme | Best for |
|------|---------|
| 🖋 Ink Classic | general default, commercial launches, when in doubt |
| 🌊 Indigo Porcelain | tech / research / AI / technical keynotes |
| 🌿 Forest Ink | nature / sustainability / culture / non-fiction |
| 🍂 Kraft Paper | nostalgic / humanist / literary / indie zines |
| 🌙 Dune | art / design / creative / gallery |

Switching themes only requires replacing the 6 variables at the top of `template.html`'s `:root{}` block — all other CSS flows through `var(--...)`.

### Style B Swiss Themes

Pick from `references/themes-swiss.md`. **Custom hex values are not allowed** here either.

| Theme | Best for |
|------|---------|
| International Klein Blue | default, commercial launch, AI products, frameworks |
| Lemon Yellow | youth, sports, retail, Y2K retro |
| Lemon Green | ecology, sustainability, Gen Z brands |
| Safety Orange | alerts, news, energetic topics |

If the user asks for a Swiss-style deck without specifying color, default to International Klein Blue.

## Core design principles

1. **Restraint over flash** — WebGL backgrounds only bleed through on hero pages
2. **Structure over decoration** — information hierarchy via type size + typeface + grid whitespace, not shadows or floating cards
3. **Images are first-class citizens** — align them with the body content area, keep ratios stable, crop only from the bottom, and preserve top/sides
4. **Generated visuals are assets** — keep only the core photo / chart / UI; do not render slide titles, footers, or corner marks inside the image
5. **Rhythm lives on hero pages** — hero / non-hero alternation keeps the eye from fatiguing
6. **Dynamic effects must be optional** — `B` toggles static mode so animation never becomes a reading burden
7. **Terms stay consistent** — Skills is Skills; no mix-and-match translations
8. **Swiss layouts stay locked** — Style B should restore and reuse the original 22-page layout system instead of inventing unrelated pages

## Visual references

- [*Monocle*](https://monocle.com) magazine layouts
- YC Garry Tan — "Thin Harness, Fat Skills"
- Massimo Vignelli / Helvetica Forever / Swiss International Typographic Style
- Guizang's offline talk deck series

## Contributing

Bugs, layout issues, new layout requests — Issues and PRs welcome. Prioritize:

- Add new classes to `template.html` first; don't let `layouts.md` reference undefined classes
- When changing `template-swiss.html`, update `layouts-swiss.md` and `swiss-layout-lock.md` together
- When adding Swiss rules, update `scripts/validate-swiss-deck.mjs`
- Log pitfalls into `checklist.md` at the matching P0 / P1 / P2 / P3 tier
- New theme colors go into `themes.md` with a recommended use case

## License

MIT © 2026 [op7418](https://github.com/op7418)
