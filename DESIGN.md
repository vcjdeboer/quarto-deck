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
- **PowerPoint both ways.** Import: inventory, original-resolution media,
  shape layers (copy of the deck with only chosen shapes on one slide, all other
  slides hidden, Keynote → vector PDF → pdftoppm 200 dpi; Keynote's own slide
  images are only 720 px). Export: one full-bleed image per slide + notes
  (exact look, not editable); Quarto's `format: pptx` loses theme, animation
  and custom HTML.
- **No npm for the browser.** Headless Chrome over DevTools with Deno's
  WebSocket; contact sheets are a grid page screenshotted by Chrome (no
  ImageMagick/ffmpeg). npm: `jszip@3.10.1`, `pptxgenjs@3.12.0`, `zod@4`.

## 2026.10.23.2

- `outline` splits the planned minutes per `#` section; the summary shows the table.

## 2026.10.23.1

- `outline` lints house style (rules vs hints; animation steps are not builds).
- `figure_crop trim=true`: ink bounds measured on a 144 dpi PPM render (pure TS).
- `.key` input for all `pptx_*` methods via a Keynote PowerPoint export of a temp copy.

## Methods

outline · render · check · export_pdf · export_pptx · source_add · source_find
· source_page · figure_crop · slide_add · journal · pptx_inventory ·
pptx_shapes · pptx_extract · pptx_layer · pptx_to_qmd

Report `deck-summary` (model-type default, runs after every method).
Workflow `@vcjdeboer/quarto-deck-build`: outline → render → check → pdf → pptx.

## Files

| file | role |
|---|---|
| `quarto_deck.ts` | model: schemas, specs, thin methods |
| `outline.ts` | include tree + slide parser (pure) |
| `render.ts` | quarto render, input hash, versions |
| `chrome.ts` | DevTools driver |
| `check.ts` | per-slide overflow, contact sheets, capture for pptx |
| `pdf.ts` | print + Quartz shrink |
| `sources.ts` | PDFs: captions, search, crop geometry |
| `slides.ts` | house slide patterns + insertion |
| `pptx.ts` | pptx XML: inventory, shapes, layer copy, Keynote export |
| `export_pptx.ts` | image-based pptx |
| `deck_summary_report.ts` | report |

## Not yet

- Redraw of schematics (Rough.js/GSAP) stays a manual/agent step guided by the skill.
