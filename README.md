# @vcjdeboer/quarto-deck

Make Quarto reveal.js lecture decks the same way every time — and keep a record
of how each one was built.

A deck is one swamp model. Every step of making it is a method: register a
paper, crop its figure, write the slide, port slides from an old PowerPoint,
render (R/knitr executes), check every slide in headless Chrome, export the
PDF or PPTX hand-out. Each step writes versioned swamp data, so you can answer
*where did this figure come from?* (paper, page, crop box, dpi, DOI) and *why
does the deck look like this?* (the build journal).

It bundles the `quarto-deck-authoring` skill, so an AI agent follows the same
process and house style: one paper, one message; titles that state the
finding; timing in the speaker notes; check before claiming done.

## Quick start

```bash
swamp extension pull @vcjdeboer/quarto-deck
swamp model create @vcjdeboer/quarto-deck/deck mytalk \
  --global-arg dir=/abs/path/to/deck \
  --global-arg main=talk.qmd \
  --global-arg slotMinutes=35

swamp model method run mytalk outline      # slides, time budget vs slot, CHECKs
swamp workflow run @vcjdeboer/quarto-deck-build --input deck=mytalk   # outline → render → check → PDF
swamp report get @vcjdeboer/quarto-deck/deck-summary --model mytalk --markdown
```

From paper to slide:

```bash
swamp model method run mytalk source_add --input pdf=path/to/paper.pdf \
  --input key=sbarra1959 --input "citation=Sbarra & Karnovsky, J Biol Chem 1959" \
  --input "doi=10.1016/S0021-9258(18)70011-2"
swamp model method run mytalk source_find --input key=sbarra1959 --input "query=Table I"
swamp model method run mytalk source_page --input key=sbarra1959 --input page=3 --input outPng=/tmp/p3.png
swamp model method run mytalk figure_crop --input key=sbarra1959 --input page=3 \
  --input 'box={"x":296,"y":250,"w":282,"h":232}' --input label=table1 --input section=history
swamp model method run mytalk slide_add --input kind=paper --input file=history/_history.qmd \
  --input figure=sbarra1959-table1 --input "title=1959: eating needs glycolysis, not oxygen" \
  --input minutes=2 --input "notes=Neutrophils keep eating without oxygen, stop when glycolysis is blocked."
```

## Methods (`@vcjdeboer/quarto-deck/deck`)

| method | what it does |
|---|---|
| `outline` | Follows `{{< include >}}`; lists slides, hidden slides, fragments, notes coverage, the `~1.5'` timings summed against `slotMinutes`, `CHECK:` markers, missing images, `.src` lines, DOIs. No render. |
| `render` | `quarto render` with code executing; records input hash, Quarto and R versions, warnings. Skips when nothing changed (`force=true` to override). |
| `check` | Every rendered slide in headless Chrome with all fragments shown: overflow beyond the slide box, contact sheets (PNG). |
| `export_pdf` | Chrome `?print-pdf`, then (macOS) a Quartz filter to shrink images for a hand-out. |
| `export_pptx` | One full-bleed image per slide plus the speaker notes. Looks exactly as rendered; not editable. |
| `source_add` | Registers a paper PDF: copy in `sources/`, checksum, pages, figure/table captions per page. |
| `source_find` | Text search in a source. |
| `source_page` | Page preview; at 72 dpi a pixel is a PDF point, for choosing crop boxes. |
| `figure_crop` | Crops a figure/table into `assets/<section>/<key>_<label>.png` with provenance. |
| `slide_add` | Writes a `paper`, `section` or `statement` slide in house style into a section file. |
| `journal` | Records a decision, request or change with its reason. |
| `pptx_inventory` | Old PowerPoint: titles, text, notes, hidden, media per slide. |
| `pptx_shapes` | Top-level shapes of one slide (ids for layers). |
| `pptx_extract` | Original-resolution media of chosen slides into `assets/`; optionally whole slides via Keynote. |
| `pptx_layer` | One slide with only chosen shapes, via Keynote → PDF → PNG (2000 px), optional white knock-out, for layered animations. |
| `pptx_to_qmd` | Stub `.qmd` for chosen slides, each with a `CHECK:` to sort it (reuse, redraw, re-crop). |

Report `@vcjdeboer/quarto-deck/deck-summary` runs after every method: time
budget, open CHECKs, overflow, figure provenance table, references, last
builds/exports, last journal entries.

Workflow `@vcjdeboer/quarto-deck-build`: outline → render → check → PDF
(`pdf=false` to skip) → PPTX (`pptx=true`).

## Requirements

- Quarto (and R or Python for decks with code)
- Google Chrome or Chromium (`chrome` global argument; macOS path by default)
- poppler (`pdfinfo`, `pdftotext`, `pdftoppm`) for sources and layers
- macOS for: PDF shrinking (Quartz filter), Keynote-based slide/layer export
- ffmpeg for transparent layers

## Compared with @webframp/presentation

webframp's extension builds reveal.js from Org or Markdown and deliberately
runs no code from the deck. This one is for Quarto decks that **execute**: R
(knitr) or Python figures are computed at render time, because the decks are
the author's own. It also covers the authoring side — papers, figures, old
PowerPoints, slide patterns and the build journal — not only build and print.

## License

MIT
