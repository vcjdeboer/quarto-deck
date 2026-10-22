---
name: quarto-deck-authoring
description: >
  Use when building or changing a Quarto reveal.js lecture/talk deck with the
  @vcjdeboer/quarto-deck model: turning a paper figure or table into a slide,
  porting slides from an old PowerPoint/Keynote deck, adding section or
  statement slides, checking timing against the slot, rendering, checking for
  overflow, or exporting the PDF/PPTX handout. Triggers on "make a slide from
  this paper", "port these slides", "is the talk too long", "render the deck",
  "check the slides", "make a PDF/PowerPoint of the talk", "quarto deck".
---

# Building a Quarto deck, the same way every time

One `@vcjdeboer/quarto-deck/deck` model per deck. Every step below is a method
on it, so every figure, slide, build and export is versioned swamp data, and
the **journal** records how the deck was built. Run `outline` often; it is
instant.

```bash
swamp model create @vcjdeboer/quarto-deck/deck mytalk \
  --global-arg dir=/abs/path/to/deck --global-arg main=talk.qmd --global-arg slotMinutes=35
```

## The process

1. **Brief first.** Audience, slot, 4–5 learning outcomes, outline in
   `prep.md`. Journal it: `journal --input kind=request --input text=...`.
2. **Paper → figure → slide** (the core loop):
   1. `source_add pdf= key=sbarra1959 citation="Sbarra & Karnovsky, J Biol Chem 1959" doi=`
      — copies the PDF to `sources/`, checksums it, lists captions per page.
   2. `source_find key= query="Table 1"` — which page.
   3. `source_page key= page=3 outPng=/tmp/p3.png` — at 72 dpi one pixel is one
      PDF point, so read the crop box straight off the image.
   4. `figure_crop key= page= box={"x":..,"y":..,"w":..,"h":..} label=table1 section=history`
      (200 dpi default). Look at the PNG; re-crop if the title or a column is cut.
   5. `slide_add kind=paper file=history/_history.qmd figure=sbarra1959-table1
      title="1959: eating needs glycolysis, not oxygen" minutes=2 notes="..."
      reference="Sbarra AJ, Karnovsky ML. J Biol Chem 234:1355–1362 (1959)"`.
3. **Reuse old decks** (never whole-slide screenshots — blurry, old theme,
   cannot animate):
   1. `pptx_inventory path=old.pptx` — titles, notes, media per slide.
   2. Sort each wanted slide and show the author the table before building:

      | content | do |
      |---|---|
      | photos, real data | `pptx_extract` the original image; write title + notes |
      | schematics | redraw (Rough.js/GSAP) so it can build on clicks |
      | journal figures | re-crop from the paper PDF (step 2) |

   3. `pptx_extract path= slides=[4,5] section=` (original resolution;
      `images=true` also renders the slides via Keynote).
   4. Animation layers: `pptx_shapes path= slide=15` → `pptx_layer ... keep=["132"]
      name=probe transparent=true` per layer (2000 px wide, white knocked out).
   5. `pptx_to_qmd path= slides=[..] file=section/_ported.qmd` gives a stub with
      a `CHECK:` per slide; rewrite each in house style.
4. **Structure**: `slide_add kind=section` for dividers (title + one-line
   subtitle), `kind=statement` for one-sentence bridges.
5. **Check before you say it is done**: `outline` (time budget, CHECKs, missing
   images), `render`, `check` (overflow per slide, contact sheets — look at
   them), or all at once:
   `swamp workflow run @vcjdeboer/quarto-deck-build --input deck=mytalk`.
6. **Hand-out**: `export_pdf` (shrinks with a Quartz filter on macOS),
   `export_pptx` when an organiser needs PowerPoint (images + notes, not
   editable).
7. **Journal every decision** with its reason, especially the author's
   requests and anything deleted or rejected:
   `journal --input kind=decision --input text="deleted the Pasteur slide: off-message" --input slide="..."`.
   `source_add`, `figure_crop`, `slide_add` and the pptx methods journal
   themselves. The `deck-summary` report shows the last entries after every run.

## House style (defaults — the author can override)

- **One paper, one message.** Paper slide = title that states the finding +
  ONE figure or table from ONE paper + ONE `.src` line. Other refs and the
  story go in the notes. No side bullets with click-by-click builds.
- **Titles are messages**, not topics ("Tumours make lactic acid; normal
  tissues barely do", not "Results").
- **Fewer slides, more talking.** In longer talks aim for ~2 min per slide;
  a slide builds over clicks only when the picture grows (animation), never as
  a bullet list. Remove clicks the author does not want.
- **Speaker notes on every slide**, starting with the timing: `~1.5'.` or
  `~45 s.` — `outline` adds them up against `slotMinutes`. Then what to say,
  then `Ref:` with the full reference and `doi:`. Put open questions on a
  `CHECK:` line; they show up in the summary until resolved.
- **Never refer to other speakers' lectures** or guess what they will cover.
- Data figures come from R chunks (knitr runs at render), not screenshots,
  when the data are yours.

## Quarto gotchas learned the hard way

- Hide a slide with `{visibility="hidden"}`. If every slide under a `#`
  section is hidden, the section slide still shows — remove the include.
- Slide numbers differ between the source, the rendered deck (the title slide
  counts) and the PDF. Name slides by title; `check` lists rendered numbers.
- Animations must have a print state: on `?print-pdf` jump timelines to the end
  (`tl.progress(1)`), or the PDF shows the first frame.
- Lazy-loaded images are blank in screenshots unless the slide is visited;
  `check` loads them for you.
- Keynote may block an export with a font dialog; if a pptx method times out,
  look at Keynote.
