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
# or by words on the page, from a paper filed in ~/papers (registered on first use); preview first
swamp model method run mytalk figure_crop --input key=10.1038/nature08778 --input page=2 \
  --input 'anchor={"from":"c","to":"Figure","near":{"x":303,"y":521}}' \
  --input label=fig3c --input section=mito --input preview=true
swamp model method run mytalk slide_add --input kind=paper --input file=history/_history.qmd \
  --input figure=sbarra1959-table1 --input "title=1959: eating needs glycolysis, not oxygen" \
  --input minutes=2 --input "notes=Neutrophils keep eating without oxygen, stop when glycolysis is blocked."
```

## Methods (`@vcjdeboer/quarto-deck/deck`)

| method | what it does |
|---|---|
| `outline` | Follows `{{< include >}}`; lists slides, hidden slides, fragments, notes coverage, the `~1.5'` timings summed against `slotMinutes`, `CHECK:` markers, missing images, missing front-matter files (`include-in-header`, `css`, `theme`, `logo`), `.src` lines, DOIs, planned **minutes per section** with a **cut view** (share of slot, three longest slides per section), the **learning-outcome check**, and **house-style findings** with rule id and file:line (see below). No render. |
| `render` | `quarto render` with code executing; records input hash, Quarto and R versions, warnings. Skips when nothing changed (`force=true` to override). |
| `slide_map` | Every slide with the number the audience sees in the slide counter (title slide = 1; hidden slides listed, unnumbered), title, kind, `file:line`, section, minutes. Checked against the built HTML; reports any disagreement or a stale build. `query=` filters titles, `around=n` prints n±3. |
| `slide_view` | One slide by shown number (`n=58`) or `title=` substring: PNG at 1280x720, scale 2, fragments shown (`fragment=i` for the state after i clicks). Returns the PNG path, `file:line` and overflow. |
| `check` | Every rendered slide in headless Chrome with all fragments shown: overflow beyond the slide box, an image/SVG/video running under the deck logo, contact sheets (PNG). |
| `export_pdf` | Hand-out PDF from screenshots: every live slide (all fragments shown, no controls) via the Reveal API, one 1280×720 page each at `scale=2`. `split=at:50` / `split=sections` / `split=[1,30,60]`, `suffix=18nov2026` (→ `talk_part1_18nov2026.pdf`), `outDir`; `format=jpeg` for small files. Writes a contact sheet per part and fails unless pages = live slide count; reports first/last slide title per part. |
| `serve` | Serves the deck folder on `http://127.0.0.1:8765` (`port=`), reusing a server already serving it, else a detached `python3 -m http.server`; returns the deck URLs. `stop=true` stops this deck's server on the port (only a `http.server` serving this folder). |
| `export_pptx` | One full-bleed image per slide plus the speaker notes. Looks exactly as rendered; not editable. |
| `source_add` | Registers a paper PDF: copy in `sources/`, checksum, pages, figure/table captions per page. Without `pdf`, finds `<doi with / as _>.pdf` and its `.json` in `papersDir` (default `~/papers`) by `doi` or key; citation from the metadata. Other source methods register such a key on first use. |
| `source_find` | Text search in a source. |
| `source_page` | Page preview with a coordinate grid in PDF points (line every 50 pt, labelled every 100 pt; `grid=false` for a clean page), for choosing crop boxes. |
| `figure_crop` | Crops a figure/table into `assets/<section>/<key>_<label>.png` with provenance. `box` in points, or `anchor={"from":"c","to":"Figure"}`: words on the page bound the figure (panel label → caption; right edge at the next panel label). `preview=true` draws the box on the page instead. `trim=true` shrinks to the ink; the PNG is always `dpi/72` px per point. |
| `figure_from_image` | Crops a screenshot, publisher figure or photo (PNG/JPEG, any path) by pixel box or fractions into `assets/<section>/<label>.png`; keeps the original, records credit and rights. JPEG EXIF orientation is applied first, so the box is on the upright photo. |
| `verify_numbers` | For a slide (title substring) or file: numbers with units/percent in shown text, `.src` and notes, looked up in the paper of the notes' DOI, with the matching sentence. Read-only. |
| `slide_add` | Writes a `paper`, `section` or `statement` slide in house style into a section file, or a diagram slide from a pattern (`compare_two`, `claim_vs_data`, `chain`, `statement_image`) and a JSON `spec`; colours from the deck's `_brand.yml`. |
| `journal` | Records a decision, request or change with its reason. |
| `slide_insert` | Inserts slide text (`file=` a .qmd, or `text=`) `after=` or `before=` a slide. |
| `slide_move` | Moves a slide with its notes `after=`/`before=` another, also into another section file. |
| `slide_delete` | Removes a slide; `park=true` (default) appends it with date and original position to the deck's `_hold*.qmd`, else `HOLD_<deck>.md`. |
| `refs_update` | Rebuilds the `.src` and `Ref:` lines of existing slides from the papers' `.json` (house style, `highlightAuthor` in bold; the figure part of `.src` is kept). Slides whose notes cite one DOI are updated; others are listed. `apply=false` (default) only lists the changes; `apply=true` snapshots and writes. |
| `outcomes_set` | Writes the same numbered learning outcomes (`items=[...]`, bold key terms) on the "Learning outcomes" and "… revisited" slides. Snapshot first. |
| `slide_edit` | Changes one slide in place: `title=` (heading attributes kept), `notes=` (timing, `Ref:` and `CHECK:` lines kept), `minutes=`, and/or `maxHeight=` of an image (`which=` when several) — e.g. the value `check` suggests to clear the logo. Snapshot first. |
| `slide_replace_image` | Copies a new image next to the old as `<name>_<8 hex>.<ext>` (no stale browser cache), rewrites the reference (`which=` when several), keeps the old file. |
| `backup_list` / `restore` | Every edit above first snapshots the files it touches in `<deck>/.deck_backups/<id>/`; `restore id=` puts one back (snapshotting first). |
| `template_list` | The deck templates: name, description, palette, latest preview sheet; marks the deck's current template. |
| `deck_init` | New deck from a template (`template=`, `title=`, `subtitle=`, `author=`, `footer=`, `logo=`, `file=`): main `.qmd` with title slide and empty learning-outcome slides, `theme/` files, `_brand.yml`, and `.deck_backups/` + `.quarto/` in the folder's `.gitignore`. Never overwrites. |
| `template_apply` | Switches an existing deck to another template (`template=`, optional `logo=`, `footer=`, `keepBrand=`); snapshot first, only template-owned YAML keys change. `recolour=true` also maps hex in the slide sources that exactly equals an old brand role colour to the new brand's colour for that role (others listed, not changed). |
| `template_preview` | Renders a sample deck once per template (`templates=` to choose): contact sheet per template and a side-by-side gallery PNG. |
| `pptx_inventory` | Old PowerPoint: titles, text, notes, hidden, media per slide. All `pptx_*` methods also take a Keynote `.key` (converted via Keynote from a temporary copy). |
| `pptx_shapes` | Top-level shapes of one slide (ids for layers). |
| `pptx_extract` | Original-resolution media of chosen slides into `assets/`; optionally whole slides via Keynote. |
| `pptx_layer` | One slide with only chosen shapes, via Keynote → PDF → PNG (2000 px), optional white knock-out, for layered animations. |
| `pptx_to_qmd` | Stub `.qmd` for chosen slides, each with a `CHECK:` to sort it (reuse, redraw, re-crop). |

### Addressing a slide

The edit methods take a slide as part of its **title** (case-insensitive; for
an untitled slide like `## {.statement .center}`, part of the text it shows),
as its **number** in the built deck's counter (title slide = 1, hidden slides
not counted), or as `file.qmd:LINE` of its heading. A title that matches more
than one slide is an error that lists the candidates. Numbers are refused when
the source cannot predict the counter (vertical navigation, `slide-level` other
than 2, `---` slide breaks) or when the last `check` counted a different total.
Each edit re-reads the outline afterwards and puts the files back if the slide
order is not the expected one; it journals itself and stores the new location
(file, line, number) as the `edit` resource.

```bash
swamp model method run mytalk slide_move --input "slide=Lean and obese mice" \
  --input "after=PKM2 knockout mice gain less weight"
swamp model method run mytalk slide_delete --input slide=42 --input "reason=off-message"
swamp model method run mytalk backup_list
swamp model method run mytalk restore --input id=2026-11-19T18-09-50
```

### House-style lint

`outline` checks every visible slide. A *paper slide* is one with a `.src`
line. Each finding has a stable id, its family and the file:line to look at.

| id | level | flags |
|---|---|---|
| `two-images` | rule | more than one image on a paper slide |
| `two-sources` | rule | more than one `.src` line |
| `builds` | rule | click builds on a paper slide (`.fragment .step` animation steps are fine) |
| `no-notes` | rule | no speaker notes |
| `no-timing` | rule | notes that do not start with `~1.5'` / `~45 s` |
| `no-ref` | hint | a paper slide whose notes cite no reference |
| `src-incomplete` | rule | a `.src` line without author, year, journal and volume:page (`Hirschey et al. 2010, Nature 464:121`); unpublished data, photo credits, newspapers and URLs are exempt (family `references`) |
| `author-not-bold` | rule | the model's `highlightAuthor` in a `.src` or `Ref:` line without `**bold**` |
| `topic-title` | hint | a bare topic word as title ("Results", "Background", "Introduction"); a finding or a plain noun phrase are both fine (family `titles`) |
| `conclusion-table` | rule | a conclusions / take-home slide written as a table (family `conclusions`) |
| `conclusion-long` | hint | more than five bullets on a conclusions slide |
| `caveat-line` | hint | shown text opening with "Caveat:", "Limitation:", "Note:" (family `caveats`) |
| `first-person`, `occasion`, `scaffolding`, `open-question`, `scaffold-title` | rule | shown text that only makes sense spoken: "we", "today", "this lecture", "slot", "rung", "Open question:", a title that opens with "Approach:" / "The control:" / "Recap" (family `narration`) |
| `spoken-line` | hint | a free-standing sentence of six words or more beside a figure |
| `svg-blank-line` | rule | a blank line inside an inline `<svg>`: Quarto ends the HTML block there and the slide breaks silently |
| `svg-small-text` | hint | SVG `font-size` below 16 |
| `lo-mismatch` | rule | "Learning outcomes" and "Learning outcomes revisited" (or `.lo` / `.lo-done`) list different items |
| `lo-uncovered` | hint | an outcome whose **bold** key terms appear on no slide |
| `unknown-ignore` | hint | `lint-ignore` names an id that does not exist |

**Accept a finding on one slide** when the author asked for it:

```markdown
## Muscle lactate in a 1924 newspaper {lint-ignore="two-images"}
```

Comma-separated ids, or a family (`lint-ignore="narration"`). Accepted findings
are listed as *suppressed* in the summary, not hidden.

**Learning outcomes.** The report lists, per outcome, its bold key terms and the
slides whose title or shown text contains them.

**Where to cut.** The log and the report show per `#` section (per included
file when the deck has no `#` headings) the slides, planned minutes, share of
the slot and the three longest slides, and how many minutes to cut.

### Diagram patterns

`slide_add kind=<pattern> spec=<json>` writes an inline-SVG slide in house
style (`class="diagram"`, `viewBox="0 0 1180 470"`;
fragments as `<g class="fragment" data-fragment-index="i">`) with no blank
lines and no text below 16, so it passes the lint. Colours come by role
(`good`, `bad`, `neutral`, `muted`) and the deck's `_brand.yml` decides the
hex: neutral = `primary`, good = `success`, bad = `danger`, muted = a grey
from the palette. Without `_brand.yml` the neutral template's colours apply. `title`, `minutes`, `notes`, `citation`
(a `.src` line) and `reference` work as for paper slides.

| kind | spec |
|---|---|
| `compare_two` | `{left: Panel, right: Panel, bottom?, build?}`; Panel = `{heading, role?, steps: [1–3], outcome, detail?}` |
| `claim_vs_data` | `{cards: [{claim, measurement, detail?}] (1–3), claimLabel?, dataLabel?, build?}` |
| `chain` | `{boxes: [{label, sub?, role?}] (2–4), arrows: [label per gap], results?: [{text, role?}] (≤3), build?}` |
| `statement_image` | `{image, lines: [1–4] (**bold** highlighted), background?, highlight?, width?}`; `title` names the record only |

```bash
swamp model method run mytalk slide_add --input kind=compare_two --input file=glyc/_04_lactate.qmd \
  --input "title=LDHA keeps glycolysis running" --input minutes=2 --input "notes=..." \
  --input 'spec={"left":{"heading":"with LDHA","role":"good","steps":["pyruvate reduced to lactate","glycolysis keeps running"],"outcome":"normal ATP supply"},"right":{"heading":"without LDHA","role":"bad","steps":["pyruvate accumulates","glycolysis slows"],"outcome":"early muscle fatigue"},"bottom":"LDHA keeps glycolysis running"}'
```

### Templates

A template is the look of a deck: colours, fonts, logo and footer placement,
title-slide colour. Four ship with the extension:

| template | look |
|---|---|
| `wur` | Wageningen University & Research: navy + Wageningen green, Archivo/IBM Plex Sans, green bar along the top, green tick under titles, navy title slide, logo bottom right. The logo is not shipped: pass `logo=` |
| `neutral` | plain academic: white, near-black text, one blue accent, Source Sans Pro |
| `dark` | dark slate, light text, teal accent; for evening talks and projectors. Figures and hand-drawn SVG sit on a light card |
| `contrast` | large rooms and printed hand-outs: white, black, one cobalt accent, Atkinson Hyperlegible, larger small print |

A deck carries its template as files: `_brand.yml` next to the main `.qmd`
(the colours; Quarto reads it too), `theme/<template>.scss` (generated from
`_brand.yml` and the template) and `theme/deck-base.html` (the house classes
`.src`, `.lo`, `.cmp`, `.task`, … on CSS variables).

```bash
swamp model method run mytalk template_list
swamp model method run mytalk template_preview       # contact sheet per template + gallery PNG
swamp model method run mytalk deck_init --input template=neutral --input "title=Mitochondria and ageing"   --input "footer=Physiology 2026 · A. Lecturer"      # new deck: YAML, title + outcome slides, theme files
```

**How to switch:** `swamp model method run mytalk template_apply --input template=dark`
— snapshots first (`restore id=` undoes it), replaces the theme files and
`_brand.yml`, rewrites only the template's YAML keys (`theme`,
`include-in-header`, title-slide background; `logo=`/`footer=` when given),
and leaves every slide as it is. Add `--input recolour=true` to carry hex
colours typed into slides along (old primary → new primary, …; exact matches
only; a hex several old roles share goes by the diagram roles first and is
reported). To change colours, edit `_brand.yml` and run
`template_apply --input template=<same> --input keepBrand=true`.

Report `@vcjdeboer/quarto-deck/deck-summary` runs after every method: time
budget, open CHECKs, overflow, figure provenance table, references, last
builds/exports, last journal entries.

Workflow `@vcjdeboer/quarto-deck-build`: outline → render → check → PDF
(`pdf=false` to skip; `pdfSplit=sections`, `pdfSuffix=18nov2026`,
`pdfFormat=jpeg` (default) / `png`, `pdfQuality=85`) → PPTX (`pptx=true`).

## Requirements

- Quarto (and R or Python for decks with code)
- Google Chrome or Chromium (`chrome` global argument; macOS path by default)
- poppler (`pdfinfo`, `pdftotext`, `pdftoppm`) for sources and layers
- macOS for: PDF shrinking (Quartz filter), Keynote-based slide/layer export
- ffmpeg for transparent layers and `figure_from_image`

## External programs

The methods drive existing tools; each is started with an argument array (no
shell), with a timeout where a run can hang:

| program | used by | for |
|---|---|---|
| `quarto` | `render` | rendering the deck (your R/Python code runs) |
| Chrome / Chromium | `check`, `export_pdf`, `export_pptx` | walking slides, screenshots, print to PDF |
| `python3` | `serve` | `http.server` bound to 127.0.0.1, detached |
| `pdfinfo`, `pdftotext`, `pdftoppm` (poppler) | `source_*`, `figure_crop`, `verify_numbers`, `pptx_layer` | page geometry, text and word boxes, cropping |
| `osascript` (macOS) | `export_pdf` shrink, `pptx_extract images=true`, `pptx_layer` | Quartz filter; Keynote export (script on stdin, paths escaped) |
| `ffmpeg` | `pptx_layer transparent=true`, `figure_from_image` | white knock-out; image crops |
| `R` | `render` | recording `R --version` |

Paths come from the model's global arguments and method inputs; methods write
only inside the deck folder (`sourcesDir`, `assetsDir`, the rendered HTML/PDF/PPTX)
unless you pass an explicit `out` path.

## Compared with @webframp/presentation

webframp's extension builds reveal.js from Org or Markdown and deliberately
runs no code from the deck. This one is for Quarto decks that **execute**: R
(knitr) or Python figures are computed at render time, because the decks are
the author's own. It also covers the authoring side — papers, figures, old
PowerPoints, slide patterns and the build journal — not only build and print.

## License

MIT
