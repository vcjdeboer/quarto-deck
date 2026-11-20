# @vcjdeboer/quarto-deck — design

Standardise the *process* of making a Quarto reveal.js lecture deck with an AI
agent: from paper PDF to slide, from old PowerPoint to new slide, from source to
a checked, distributable deck — and record how the deck was built.

## Decisions

- **One model per deck** (`@vcjdeboer/quarto-deck/deck`), not separate source /
  pptx / slide types: all provenance (slide → figure → paper → page → box) and
  the journal live in one model's data, so the summary report reads one model.
- **The deck executes.** Unlike `@webframp/presentation` (untrusted decks, no
  code), Quarto runs R/knitr or Python at render: these are the author's own
  decks and data figures come from code.
- **Capture the process, not just the result.** `journal` entries (decision,
  request, change, …) are versions of one resource; `source_add`,
  `figure_crop`, `slide_add` and the pptx methods journal themselves.
- **House style lives in two places:** as code (`slides.ts`: paper slide = one
  figure, one `.src`, notes with timing + ref + DOI, no fragments) and as the
  bundled `quarto-deck-authoring` skill (process + rules + gotchas).
- **Edits are reversible and checked.** Snapshots go in the deck folder
  (`.deck_backups/`, ignored by Quarto as a dot folder), not in swamp data, so
  a restore works with plain `cp` too. After writing, the new outline must show
  exactly the expected slide order, else the files are put back. A slide
  counter number is only accepted when the source can predict it.
- **PowerPoint both ways.** Import: inventory, original-resolution media,
  shape layers (copy of the deck with only chosen shapes on one slide, all other
  slides hidden, Keynote → vector PDF → pdftoppm 200 dpi; Keynote's own slide
  images are only 720 px). Export: one full-bleed image per slide + notes
  (exact look, not editable); Quarto's `format: pptx` loses theme, animation
  and custom HTML.
- **No npm for the browser.** Headless Chrome over DevTools with Deno's
  WebSocket; contact sheets are a grid page screenshotted by Chrome (no
  ImageMagick/ffmpeg). npm: `jszip@3.10.1`, `pptxgenjs@3.12.0`, `zod@4`.


## The slide contract

The lint exists so house style is a property of the deck, not something the
author or the agent has to remember. Names used throughout the code and the
skill:

| term | meaning |
|---|---|
| **slide** | a `##` heading and everything under it, minus the notes |
| **paper slide** | a slide with a `.src` line: one finding from one paper |
| **statement slide** | `{.statement}`: one sentence or one question, no figure |
| **exercise slide** | a slide whose body is a `.task` or `.exam` block |
| **shown text** | title + body prose + `<text>` inside an inline SVG |
| **notes** | the `::: notes` block: everything the author says out loud |

Invariants, checked by `outline` on every visible slide:

1. **A paper slide shows one figure from one source**, without click builds.
2. **Every slide has notes, and the notes start with a timing.**
3. **A paper slide's notes cite a reference** (hint).
4. **Shown text states facts; narration lives in the notes.** Shown text may not
   use the first person, name the occasion ("today", "this lecture"), use
   timetable or scaffolding words ("slot", "rung", "before the break"), or open
   with "Open question:". Titles may not begin with "Approach:", "The control:",
   "The general rule:", "Recap", "Key figure" and the like: a title states the
   finding, not the role the slide plays in the argument.

Rule 4 is a **rule** for those markers, which are unambiguous, and a **hint**
for a free-standing sentence of six words or more next to a figure, which is
usually a spoken take-home line but is sometimes a legitimate result.

5. **An inline SVG has no blank line inside `<svg>…</svg>`.** Markdown ends a
   raw HTML block at a blank line, so Quarto splits the diagram there and the
   slide breaks without an error. SVG text is at least font-size 16 (hint).
6. **The opening and closing learning outcomes are the same list**, and every
   outcome's bold key terms appear on at least one slide (hint).

### Rule ids

Every finding has a stable short `id` (the name to use in `lint-ignore`) and a
`rule` family (kept from earlier releases, so stored outlines still read).
`LINT_RULES` in `outline.ts` is the source of truth.

| id | family | level | flags |
|---|---|---|---|
| `two-images` | one-figure | rule | more than one image on a paper slide |
| `two-sources` | one-source | rule | more than one `.src` line |
| `builds` | no-builds | rule | click builds on a paper slide |
| `no-notes` | notes | rule | no speaker notes |
| `no-timing` | timing | rule | notes without `~1.5'` / `~45 s` |
| `no-ref` | doi | hint | paper slide whose notes cite no reference |
| `first-person` | narration | rule | we, us, our, let's |
| `occasion` | narration | rule | today, this lecture, the whole talk, next slide |
| `scaffolding` | narration | rule | slot, rung, before/after the break |
| `open-question` | narration | rule | shown text opening with "Open question" |
| `scaffold-title` | narration | rule | title opening with Approach:, The control:, Recap … |
| `spoken-line` | narration | hint | sentence of 6+ words beside a figure |
| `svg-blank-line` | svg | rule | blank line inside an inline `<svg>` (reported with file:line) |
| `svg-small-text` | svg | hint | SVG `font-size` below 16 |
| `lo-mismatch` | outcomes | rule | opening and closing outcome lists differ |
| `lo-uncovered` | outcomes | hint | an outcome whose key terms appear on no slide |
| `unknown-ignore` | lint | hint | `lint-ignore` names an id that does not exist |

**Accepting a finding.** The author sometimes asks for exactly what the lint
flags (a paper slide with a photo inset; a bottom line that has to say "slot").
`## Title {lint-ignore="two-images,scaffolding"}` accepts those ids, or a
whole family (`lint-ignore="narration"`), on that slide only. Accepted findings
go to `suppressed` and are counted in the summary, never dropped silently.

### Learning outcomes

Opening list: the slide titled "Learning outcomes" or holding a `.lo` div.
Closing list: "Learning outcomes revisited" (or `.lo-done`). Numbered items are
compared as text after whitespace normalisation. Coverage: each `**bold**` key
term is split on commas, "and", "or" and "/" and matched against the shown
text of every other visible slide, word by word as prefixes (long words lose
three letters, so "mammalian" finds "mammals"). Crude on purpose: it finds
outcomes nobody teaches, it does not prove the teaching.

### Cut view

Per `#` section (per included file when the deck has no `#` headings): slides,
planned minutes, share of the slot and the three longest slides; plus the total
over or under. It answers "where do I cut 80 minutes" without opening the deck.

### Diagram patterns

`slide_add` writes four house diagram layouts from structured input
(`slides.ts`, `PATTERNS`): `compare_two`, `claim_vs_data`, `chain`,
`statement_image`. Colours come by role (`good`, `bad`, `neutral`, `muted`),
not hex; the role → hex mapping is read from the deck's `_brand.yml` (see
Templates). Generated SVG has no blank line, no text below 16, one text element
per line (so the lint reads it), no closing full stop on diagram text (it would
read as a spoken line), drawn arrow heads instead of `<marker>` ids (no id
clashes between slides), and fragments as
`<g class="fragment" data-fragment-index="i">`. Text is wrapped and shrunk to fit by
an estimate of glyph width, so `check` remains the judge of overflow.

### Templates and brand

The look of a deck is data in the deck, not code: Quarto's `_brand.yml` next
to the main file holds the colours (palette + roles `primary`, `success`,
`danger`, `foreground`, `background`), logo and fonts. `brand.ts` maps it
onto what the patterns need: neutral → primary, good → success, bad →
danger, muted → a grey from the palette (or text mixed into background),
plus surface, pill, tints, highlight, section and title-slide colours
(optional palette names; derived when absent). Without `_brand.yml` the
`neutral` template's colours apply. No WUR colour appears in code; a test
enforces it.

A template (`templates/<name>/`) is a `_brand.yml` plus a `theme.scss`
(fonts, switches such as the top bar and title tick, template-only rules).
The structure every template needs is shared: `templates/shared/deck-base.html`
(the house classes `.src`, `.lo`, `.cmp`, `.task`, … against CSS variables
`--qd-*`), `defaults.scss` and `rules.scss` (against `$qd-*`). A deck gets
`theme/<name>.scss` generated as palette-from-`_brand.yml` + template
defaults + shared defaults + shared rules + template rules, so `_brand.yml`
is the single source of colour. The quarto variables that `_brand.yml` would
also set (`$body-bg`, fonts, heading colour) are set outright, so the theme
wins over Quarto's brand layer. The files are embedded in
`templates_bundle.ts` (`templates/build.ts`; a test keeps it in sync), so
the model never reads files relative to its own module.

`template_apply` rewrites only the keys a template owns, line by line
(comments and every other key stay byte for byte): `theme` (any
`theme/*.scss` entry is replaced, other entries kept), `include-in-header`
(`theme/deck-base.html` replaces `theme/deck-extras.html`, the
earlier name for the same classes; other includes kept, also `text:` blocks),
the title-slide `data-background-color`, and `logo`/`footer` only when
given. Slide content is never touched, so hex written into slides by hand or
by `slide_add` keeps its colours: the `dark` template puts light-page
content (figures, hand-drawn SVG) on a light card, except on slides with
their own dark background and diagrams drawn with the dark palette
(`data-bg="dark"`).

## 2026.11.20.1

- **Templates**: `wur`, `neutral`, `dark`, `contrast` (`templates/`), colours from the deck's `_brand.yml` (`brand.ts`); shared classes in `deck-base.html`. Methods `template_list`, `deck_init`, `template_apply` (snapshot first; `keepBrand=true`, opt-in `recolour=true`), `template_preview`.
- **Edit methods**: `slide_insert`, `slide_move`, `slide_delete` (`park=true` to a hold file), `slide_replace_image` (content-hashed name), `slide_edit` (title, notes, minutes, image maxHeight); every edit snapshots, re-checks the slide order and journals itself; `backup_list` / `restore` undo.
- **Diagram patterns** for `slide_add`: `compare_two`, `claim_vs_data`, `chain`, `statement_image`, from a JSON `spec`.
- `slide_add` creates the section file's folder and includes a new file in the main `.qmd`; `kind=section` keeps `notes=`.
- **References from paper metadata**: `source_add` keeps the `.json` metadata; `slide_add kind=paper` writes the `.src` line and notes reference in house style; `refs_update` (dry run by default) fixes existing slides. Global argument `highlightAuthor` (e.g. `van Dam`) bolds the lecturer.
- **Lint**: stable ids with file:line and slide-counter number; `lint-ignore="id,…"` per slide (counted as suppressed). New: `svg-blank-line`, `svg-small-text`, narration rules, `topic-title`, `conclusion-table`, `conclusion-long`, `caveat-line`, `src-incomplete`, `author-not-bold`; missing front-matter files are reported.
- **Learning outcomes**: opening and closing lists must match (`lo-mismatch`); per-outcome coverage (`lo-uncovered`); `outcomes_set` writes both lists.
- **Cut view**: per section slides, minutes, share of slot and longest slides.
- `export_pdf` from live-slide screenshots, with `split`, `suffix`, `outDir`, contact sheets and a page-count check; the deck-build workflow passes `pdfSplit`, `pdfSuffix`, `pdfFormat`, `pdfQuality`.
- `serve` (127.0.0.1, reuses only a server for this folder; `stop=true`), `slide_map`, `slide_view`.
- `figure_crop anchor=` (crop box from word positions; `panels="all"`, `preview=true`); `source_page` and the preview draw a PDF-point grid; `figure_from_image` (pixel or fraction box, EXIF orientation).
- `source_add` finds `<doi>.pdf` and `.json` in `papersDir`; `verify_numbers` looks up numbers from a slide in the paper text.
- `check` reports figures under the logo and suggests the `maxHeight` that clears it.
- `deck_init` adds `.deck_backups/` and `.quarto/` to `.gitignore`.

## 2026.10.23.2

- `outline` splits the planned minutes per `#` section; the summary shows the table.

## 2026.10.23.1

- `outline` lints house style (rules vs hints; animation steps are not builds).
- `figure_crop trim=true`: ink bounds measured on a 144 dpi PPM render (pure TS).
- `.key` input for all `pptx_*` methods via a Keynote PowerPoint export of a temp copy.

## Methods

outline · slide_map · slide_view · render · check · export_pdf · export_pptx · serve · source_add · source_find
· source_page · figure_crop · figure_from_image · verify_numbers · slide_add · journal · slide_insert · slide_move
· slide_delete · slide_replace_image · backup_list · restore · template_list · deck_init · template_apply
· template_preview · pptx_inventory · pptx_shapes · pptx_extract · pptx_layer · pptx_to_qmd

Report `deck-summary` (model-type default, runs after every method).
Workflow `@vcjdeboer/quarto-deck-build`: outline → render → check → pdf → pptx;
`pdfSplit`, `pdfSuffix`, `pdfFormat` (jpeg), `pdfQuality` (85) go to `export_pdf`.

## Files

| file | role |
|---|---|
| `quarto_deck.ts` | model: schemas, specs, thin methods |
| `outline.ts` | include tree + slide parser + lint, learning outcomes, cut view (pure) |
| `outline_schema.ts` | zod schemas of the lint parts of the stored outline |
| `render.ts` | quarto render, input hash, versions |
| `chrome.ts` | DevTools driver |
| `check.ts` | per-slide overflow, contact sheets, capture for pptx |
| `slidemap.ts` | shown slide numbers, HTML agreement, single-slide view |
| `export.ts` | hand-out PDF from screenshots: split, verify, contact sheets |
| `serve.ts` | local static server for the deck folder |
| `pdf.ts` | page count + Quartz shrink |
| `sources.ts` | PDFs: captions, search, crop geometry |
| `figures.ts` | anchored crops, preview, papers folder, image crops, number check |
| `slides.ts` | house slide patterns, diagram patterns (SVG) + insertion |
| `brand.ts` | `_brand.yml` → palette of colour roles (pure + read) |
| `templates.ts` | template library, theme generation, YAML key rewrite, deck_init / template_apply / template_preview |
| `templates/` | template files (`shared/`, `wur/`, `neutral/`, `dark/`, `contrast/`, `sample/`); `build.ts` → `templates_bundle.ts` |
| `edit.ts` | slide addressing, insert/move/delete/replace image, snapshots |
| `pptx.ts` | pptx XML: inventory, shapes, layer copy, Keynote export |
| `export_pptx.ts` | image-based pptx |
| `deck_summary_report.ts` | report |

## Not yet

- Redraw of schematics (Rough.js/GSAP) stays a manual/agent step guided by the skill.
