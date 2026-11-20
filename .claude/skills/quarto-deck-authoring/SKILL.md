---
name: quarto-deck-authoring
description: >
  Use when building or changing a Quarto reveal.js lecture/talk deck with the
  @vcjdeboer/quarto-deck model: turning a paper figure or table into a slide,
  porting slides from an old PowerPoint/Keynote deck, adding section or
  statement slides, checking timing against the slot, rendering, checking for
  overflow, or exporting the PDF/PPTX handout. Triggers on "make a slide from
  this paper", "port these slides", "is the talk too long", "render the deck",
  "check the slides", "make a PDF/PowerPoint of the talk", "quarto deck",
  "start a new deck", "switch the deck to the dark/neutral template".
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
   **A new deck starts with `deck_init`**, never a hand-written YAML header:
   `deck_init template=wur title="…" footer="…" logo=assets/logo.png`
   (`template_list` / `template_preview` show the choice: `wur`, `neutral`,
   `dark`, `contrast`). It writes the main `.qmd` (title slide + empty
   "Learning outcomes" / "Learning outcomes revisited"), `theme/` and
   `_brand.yml`. To change an existing deck's look: `template_apply
   template=dark` (snapshot first; `restore id=` undoes it); it changes only
   the template's YAML keys and files, never a slide.
2. **Paper → figure → slide** (the core loop):
   1. `source_add doi=10.1038/nature08778` when the paper is filed in `~/papers`
      (`<doi with / as _>.pdf` + `.json`): key and citation come from the
      metadata (`hirschey2010`, "Hirschey et al., Nature 2010"). Otherwise
      `source_add pdf= key= citation= doi=`. Copies the PDF to `sources/`,
      checksums it, lists captions per page. The other source methods register
      a DOI or key from `~/papers` on first use.
   2. `source_find key= query="Table 1"` — which page.
   3. `source_page key= page=3 outPng=/tmp/p3.png` — at 72 dpi one pixel is one
      PDF point, so read the crop box straight off the image.
   4. Do not guess boxes from the preview. Anchor on words:
      `figure_crop key= page= anchor={"from":"c","to":"Figure","near":{"x":303,"y":521}} label=fig3c section= preview=true`
      — `from` = panel label (top-left), `to` = caption start (excluded),
      right edge = next panel label on the row (or `right=`/`w=`), `near`
      when the label occurs more than once (the error lists the candidates).
      Look at the preview (red box), then run it again without `preview`.
      `box={"x":..,"y":..,"w":..,"h":..}` in points still works; `trim=true`
      shrinks to the ink. The PNG is always dpi/72 px per point
      (`pxPerPt`), so a pixel in it maps back to the page as
      `boxPt + px/pxPerPt`. Look at the PNG.
   4b. Not a paper PDF (screenshot, publisher `gr1_lrg.jpg`, photo):
      `figure_from_image image="/path with spaces/x.png" box={"x":0,"y":0,"w":0.5,"h":0.5} label= section= credit="A. van Dam, unpublished" rights=`
      — pixels or fractions; never `sips --cropOffset` (offset 0 is ignored).
      Use it as `slide_add figure=image-<label>`.
   5. `slide_add kind=paper file=history/_history.qmd figure=sbarra1959-table1
      title="1959: eating needs glycolysis, not oxygen" minutes=2 notes="..."
      reference="Sbarra AJ, Karnovsky ML. J Biol Chem 234:1355–1362 (1959)"`.
3. **Reuse old decks** (never whole-slide screenshots — blurry, old theme,
   cannot animate):
   1. `pptx_inventory path=old.pptx` (or `old.key`) — titles, notes, media per slide.
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
   **Diagrams**: do not hand-write the house SVG layouts; use
   `slide_add kind=compare_two|claim_vs_data|chain|statement_image spec='{…}'`
   (see the README for each spec). Diagrams and section dividers take their
   colours from the deck's `_brand.yml` (no brand file: neutral defaults).
   **Never hard-code hex in slides**: use a role in the spec (`good`, `bad`,
   `neutral`, `muted`) or a class from `theme/deck-base.html`; to change a
   colour, edit `_brand.yml` and run `template_apply template=<same>
   keepBrand=true`. Hex typed into a slide follows a template switch only
   with `recolour=true` (exact brand-colour matches; read the warnings).
   Hand-edit the result if needed, and never
   leave a blank line inside `<svg>…</svg>`: Quarto splits the slide there
   without an error (`outline` reports it as `svg-blank-line` with file:line).
5. **Check numbers in the notes against the paper**: `verify_numbers
   slide="<title words>"` lists each number with a unit or percent as found
   (with the sentence), number-only or not-found. Fix or put the not-found ones
   on a `CHECK:` line (e.g. values read from a plot).
6. **Change slides with the edit methods**, not ad-hoc scripts: `slide_insert
   after="Block PFK1" file=new.qmd`, `slide_move slide="Lean and obese mice"
   after="PKM2 knockout mice gain"`, `slide_delete slide=42` (parks it in
   the hold file), `slide_replace_image slide=... image=new.png` (new hashed
   name; never overwrite an image under its old name, the browser keeps showing
   the cached one). Address an untitled slide by the text it shows. Each edit
   snapshots, journals itself and returns file:line; `backup_list` + `restore
   id=` undo it. Restore snapshots newest first when undoing several edits to
   the same file: a snapshot is the file as it was at that moment.
7. **Check before you say it is done**: `outline` (time budget, CHECKs, missing
   images, house-style findings — fix the rules, judge the hints), `render`,
   `check` (overflow per slide, contact sheets — look at them), or all at once:
   `swamp workflow run @vcjdeboer/quarto-deck-build --input deck=mytalk`.
   When the author asks for something the lint flags, accept it on that slide
   with `{lint-ignore="<id>"}` on the heading (ids in the README) and journal
   why; do not argue it away or silence the whole rule. When the deck is over
   the slot, read the cut view (per section: share of slot, longest slides)
   and propose cuts there. Keep "Learning outcomes" and "Learning outcomes
   revisited" identical: edit both, or `outline` fails with `lo-mismatch`.
8. **Hand-out**: `export_pdf split=at:50 suffix=18nov2026` (or
   `split=sections`; `format=jpeg` for a small file). It screenshots the live
   slides, so hidden slides and fragments are handled; check the verification
   line (pages = live slides, first/last title per part) and the contact sheet.
   To fix a slide (title, notes, timing, image size) use `slide_edit`, not a
   delete + re-add; when `check` reports a figure under the logo it prints the
   `slide_edit … maxHeight=` that clears it.
   Do not build a PDF by hand with `?print-pdf` or `#/k` URLs. `serve` gives
   an `http://127.0.0.1` URL for the deck (speaker view needs one).
   `export_pptx` when an organiser needs PowerPoint (images + notes, not
   editable).
9. **Journal every decision** with its reason, especially the author's
   requests and anything deleted or rejected:
   `journal --input kind=decision --input text="deleted the Pasteur slide: off-message" --input slide="..."`.
   `source_add`, `figure_crop`, `slide_add`, the edit methods and the pptx
   methods journal themselves. The `deck-summary` report shows the last entries after every run.

## House style (defaults — the author can override)

- **One paper, one message.** Paper slide = ONE figure or table from ONE
  paper + ONE `.src` line, under a title of either kind below. Other refs and the
  story go in the notes. No side bullets with click-by-click builds.
- **Titles: the finding or a plain noun phrase — the author chooses.** Either
  state the finding ("Tumours make lactic acid; normal tissues barely do") or
  name what the slide shows ("Lactate output of tumour and normal tissue").
  The author often wants the noun phrase: do not rewrite one into a finding
  unasked. Never a bare topic word ("Results", "Background") and never a
  scaffold opener (below). `outline`: `scaffold-title` (rule), `topic-title`
  (hint).
- **Fewer slides, more talking.** In longer talks aim for ~2 min per slide;
  a slide builds over clicks only when the picture grows (animation), never as
  a bullet list. Remove clicks the author does not want.
- **Speaker notes on every slide**, starting with the timing: `~1.5'.` or
  `~45 s.` — `outline` adds them up against `slotMinutes`. Then what to say,
  then `Ref:` with the full reference and `doi:`. Put open questions on a
  `CHECK:` line; they show up in the summary until resolved.
- **The slide states facts; the narration lives in the notes.** Before you
  render, read every sentence that will appear on a slide. If it only makes
  sense spoken by the lecturer, in that room, on that day, cut it to the notes.
  No first person, no "today" or "this lecture", no timetable or scaffolding
  words ("slot", "rung", "before the break"), no "Open question:" line, and no
  title opening with "Approach:", "The control:", "The general rule:" or
  "Recap". `outline` flags all of this as the **narration** rule, and flags a
  spare sentence next to a figure as a hint.
- **Conclusions are a few bullets, each tied to a slide of the talk** — never
  a table, and nothing that was not shown. `outline`: `conclusion-table`
  (rule), more than five bullets `conclusion-long` (hint).
- **Precise terms on slides.** Write the exact biochemical state or entity:
  "phosphorylated", not "phosphate"; "acetylated lysine", not "acetyl"; the
  enzyme, not "the protein". The notes may be looser; the slide may not.
- **One story per section.** Each `#` section carries one line of argument;
  a slide that belongs to another story moves to that section or out.
- **No caveats the author did not raise.** Do not add limitations, "note
  that…" or hedges to slides or notes on your own; keep the ones the author
  says in the talk. `outline` hints at shown lines opening with Caveat:,
  Limitation: or Note: (`caveat-line`).
- **References come from the paper, never from memory.** Register every paper
  with `source_add` (its `.json` in `papersDir` carries authors, journal,
  volume, pages). `slide_add kind=paper figure=…` then writes the `.src` line
  and the notes reference from that metadata; a typed `citation=` or
  `reference=` is ignored for a registered paper. Add figure details with
  `srcDetail="Fig. 2A,B. Skin fibroblasts"`. Never type an author list, title
  or page numbers yourself; if a paper has no `.json`, copy them from its
  first page and add a `CHECK:` line.
- **Existing decks:** `refs_update` lists what it would change in every
  `.src` / `Ref:` line; review, then `refs_update apply=true`.
- **Reference style.** Slide (`.src`): `Hirschey et al. 2010, Nature 464:121`
  — first author, year, abbreviated journal, volume:first page; two authors
  `A & B`. Notes: `Ref: Hirschey MD, Shimazu T, … (2010) Title. Nature
  464:121–125, doi:…` (up to ten authors, else first three … last).
- **The lecturer in bold.** Set the model's `highlightAuthor` (e.g. `van
  Dam`). On a paper they co-authored the `.src` lists the authors up to them
  (`Okafor, Lindqvist, Santos, **van Dam** et al. 2017, Mol Cell 68:412`; last
  author: `Becker, Marino ... **van Dam** & Okoro 2021, iScience 24:102345`;
  five or fewer: all names) and the notes reference bolds them. `outline`
  flags an incomplete `.src` (`src-incomplete`) and the name not in bold
  (`author-not-bold`).
- **Never refer to other speakers' lectures** or guess what they will cover.
- Data figures come from R chunks (knitr runs at render), not screenshots,
  when the data are yours.

## Quarto gotchas learned the hard way

- Hide a slide with `{visibility="hidden"}`. If every slide under a `#`
  section is hidden, the section slide still shows — remove the include.
- The author names slides by the number in the slide counter. That number
  counts the title slide and skips hidden slides, so it is not the source
  order. Before editing "slide 78", run `slide_map --input around=78` and edit
  the `file:line` it gives; `slide_view --input n=78` shows the slide itself
  (PNG path in the output, open it). `check` and the contact sheets use the
  same numbers. The edit methods accept the same
  number when the source can predict it.
- Animations must have a print state: on `?print-pdf` jump timelines to the end
  (`tl.progress(1)`), or the PDF shows the first frame.
- Lazy-loaded images are blank in screenshots unless the slide is visited;
  `check` loads them for you.
- Keynote may block an export with a font dialog; if a pptx method times out,
  look at Keynote.
