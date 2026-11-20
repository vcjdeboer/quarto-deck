import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import {
  cutLines,
  cutView,
  issueSlide,
  learningOutcomes,
  LINT_RULES,
  lintDeck,
  mentions,
  outlineFromSlides,
  parseIgnore,
  parseQmd,
  shownNumbers,
  type SourceLine,
  styleIssues,
  termParts,
} from "./outline.ts";
import {
  chainSvg,
  claimVsDataSvg,
  compareTwoSvg,
  fitText,
  PATTERN_KINDS,
  patternSlide,
  statementImageBody,
} from "./slides.ts";
import { summarize } from "./deck_summary_report.ts";
import { brandPalette } from "./brand.ts";
import { templateBrand } from "./templates.ts";

const WUR = brandPalette(templateBrand("wur"));
import { model } from "./quarto_deck.ts";

const src = (text: string, file = "main.qmd"): SourceLine[] =>
  text.split("\n").map((t, i) => ({ file, line: i + 1, text: t }));
const slidesOf = (text: string, file = "main.qmd") =>
  parseQmd(src(text, file)).slides;

// --- rule ids ---------------------------------------------------------------

Deno.test("every rule id is short, kebab-case and has a family and level", () => {
  for (const [id, r] of Object.entries(LINT_RULES)) {
    assertEquals(/^[a-z][a-z-]{2,20}$/.test(id), true, id);
    assertEquals(["rule", "hint"].includes(r.level), true, id);
    assertEquals(r.what.length > 5, true, id);
  }
});

Deno.test("every finding carries its id, family, file and line", () => {
  const issues = styleIssues(slidesOf(
    "## Paper\n\n![](a.png)\n![](b.png)\n\n[A]{.src}\n",
    "sec/_a.qmd",
  ));
  const ids = issues.map((i) => i.id);
  assertEquals(ids, ["two-images", "no-notes"]);
  assertEquals(issues[0].rule, "one-figure");
  assertEquals(issues[0].file, "sec/_a.qmd");
  assertEquals(issues[0].line, 1);
});

// --- SVG --------------------------------------------------------------------

const SVG_BLANK = `## Two panels

<svg class="diagram" viewBox="0 0 1180 470">
  <text x="1" y="1" font-size="24">left</text>

  <text x="2" y="2" font-size="24">right</text>
</svg>

::: notes
~1'. x
:::
`;

Deno.test("svg-blank-line: a blank line inside <svg> is a rule with file:line", () => {
  const issues = styleIssues(slidesOf(SVG_BLANK, "glyc/_04.qmd"));
  const blank = issues.filter((i) => i.id === "svg-blank-line");
  assertEquals(blank.length, 1);
  assertEquals(blank[0].level, "rule");
  assertEquals(blank[0].file, "glyc/_04.qmd");
  assertEquals(blank[0].line, 5);
  assertStringIncludes(blank[0].message, "glyc/_04.qmd:5");
});

Deno.test("svg-blank-line: blank lines around the svg or in a fenced html block are fine", () => {
  const ok = `## Fine

<svg class="diagram" viewBox="0 0 10 10"><text font-size="20">a</text></svg>

<svg viewBox="0 0 10 10">
  <text font-size="20">b</text>
</svg>

\`\`\`{=html}
<svg viewBox="0 0 10 10">

</svg>
\`\`\`

::: notes
~1'. x
:::
`;
  assertEquals(styleIssues(slidesOf(ok)).filter((i) => i.rule === "svg"), []);
});

Deno.test("svg-blank-line is reported on section slides too", () => {
  const sec = '# Part {.section}\n\n<svg viewBox="0 0 1 1">\n\n</svg>\n';
  assertEquals(
    styleIssues(slidesOf(sec)).map((i) => i.id),
    ["svg-blank-line"],
  );
});

Deno.test("svg-small-text: font-size below 16 is one hint per slide with the smallest size", () => {
  const s = `## Small

<svg viewBox="0 0 10 10">
  <text font-size="24">big</text>
  <text font-size="12">Ac</text>
  <text style="font-size: 14px">tiny</text>
  <text font-size="1.2em">relative units are left alone</text>
</svg>

::: notes
~1'. x
:::
`;
  const hints = styleIssues(slidesOf(s)).filter((i) =>
    i.id === "svg-small-text"
  );
  assertEquals(hints.length, 1);
  assertEquals(hints[0].level, "hint");
  assertEquals(hints[0].line, 5);
  assertStringIncludes(hints[0].message, "2 SVG texts");
  assertStringIncludes(hints[0].message, "smallest 12");
});

// --- lint-ignore ------------------------------------------------------------

Deno.test("parseIgnore reads comma or space separated ids", () => {
  assertEquals(parseIgnore('Title {lint-ignore="two-images,scaffolding"}'), [
    "two-images",
    "scaffolding",
  ]);
  assertEquals(parseIgnore("T {.x lint-ignore='a b'}"), ["a", "b"]);
  assertEquals(parseIgnore("T {.x}"), []);
  assertEquals(parseIgnore("T"), []);
});

const PRESS =
  `## Muscle lactate in The Daily Courier, 1924 {lint-ignore="two-images"}

![](inset.png)

![](article.png)

[The Daily Courier newspaper, 1924]{.src}

::: notes
~1.5'. x
Ref: Daily Courier newspaper, 1924.
:::

## A slot for questions {lint-ignore="narration"}

::: notes
~1'. x
:::

## The real thing {lint-ignore="two-imgs"}

::: notes
~1'. x
:::
`;

Deno.test("lint-ignore moves findings to suppressed (by id or family) and flags unknown ids", () => {
  const { issues, suppressed } = lintDeck(slidesOf(PRESS));
  assertEquals(suppressed.map((x) => `${x.slide}:${x.id}`), [
    "1:two-images",
    "2:scaffolding",
  ]);
  assertEquals(issues.map((x) => `${x.slide}:${x.id}:${x.level}`), [
    "3:unknown-ignore:hint",
  ]);
  const o = outlineFromSlides("m.qmd", ["m.qmd"], parseQmd(src(PRESS)));
  assertEquals(o.suppressed.length, 2);
  assertEquals(o.styleIssues.length, 1);
});

Deno.test("references: incomplete .src lines and the lecturer not in bold", () => {
  const N = (ref: string) => `\n\n::: notes\n~1'. x\nRef: ${ref}\n:::\n`;
  const ids = (text: string) =>
    lintDeck(slidesOf(text), false, "van Dam").issues
      .filter((i) => i.rule === "references").map((i) => i.id);
  assertEquals(
    ids("## A\n\n![](a.png)\n\n[Hirschey et al. 2010, Nature 464:121, Fig. 3]{.src}" + N("Hirschey MD (2010) T. Nature 464:121–125")),
    [],
  );
  assertEquals(ids("## A\n\n![](a.png)\n\n[Hirschey et al., Nature 2010]{.src}" + N("x")), ["src-incomplete"]);
  assertEquals(ids("## A\n\n![](a.png)\n\n[van Dam, unpublished]{.src}" + N("x")), ["author-not-bold"]);
  assertEquals(
    ids("## A\n\n![](a.png)\n\n[Okafor, Lindqvist, Santos, van Dam et al. 2017, Mol Cell 68:412]{.src}" + N("Okafor L, **van Dam AM** (2017) T. Mol Cell 68:412–425")),
    ["author-not-bold"],
  );
  assertEquals(
    ids("## A\n\n![](a.png)\n\n[Okafor, Lindqvist, Santos, **van Dam** et al. 2017, Mol Cell 68:412]{.src}" + N("Okafor L, van Dam AM (2017)")),
    ["author-not-bold"],
  );
});

Deno.test("lint findings carry the slide-counter number", () => {
  const text = [
    "---",
    "title: T",
    "---",
    "",
    '## Hidden {visibility="hidden"}',
    "",
    "## Two {lint-ignore=\"nope\"}",
    "",
  ].join("\n");
  const o = outlineFromSlides("m.qmd", ["m.qmd"], parseQmd(src(text)));
  const x = o.styleIssues.find((i) => i.id === "unknown-ignore")!;
  // source slide 2; title slide = 1, hidden slide unnumbered -> counter 2
  assertEquals([x.slide, x.shown], [2, 2]);
  assertEquals(issueSlide({ slide: 5, shown: null }), "hidden slide (source 5)");
  assertEquals(shownNumbers(parseQmd(src(text)).slides, false).get(2), 1);
});

Deno.test("lint-ignore only suppresses the named id", () => {
  const { issues, suppressed } = lintDeck(slidesOf(
    '## A slot {lint-ignore="two-images"}\n\n::: notes\n~1\'. x\n:::\n',
  ));
  assertEquals(suppressed, []);
  assertEquals(issues.map((i) => i.id), ["scaffolding"]);
});

// --- learning outcomes -----------------------------------------------------

const LO = (closing2: string) =>
  `## Learning outcomes

::: {.lo}
1. Explain how **HK2** became a tumour marker.
2. Name the **ten glycolytic enzymes** and where they work.
3. Describe how the **lactate and pfk-1.1** claims were tested.
4. Explain **glycation chemistry**.
:::

::: notes
~2'. x
:::

## Hk2 binds mitochondria in tumour cells

::: notes
~1'. x
:::

## Ten enzymes in glycolysis

::: notes
~1'. x
:::

## The worm pfk-1.1 result was a passenger mutation

::: notes
~1'. x
:::

## Learning outcomes revisited

::: {.lo-done}
1. Explain how **HK2** became a tumour marker.
${closing2}
3. Describe how the **lactate and pfk-1.1** claims were tested.
4. Explain **glycation chemistry**.
:::

::: notes
~2'. x
:::
`;
const SAME = "2. Name the **ten glycolytic enzymes** and where they work.";

Deno.test("learning outcomes: identical lists match and coverage lists slides per outcome", () => {
  const r = learningOutcomes(slidesOf(LO(SAME)))!;
  assertEquals([r.opening, r.closing, r.match], [1, 5, true]);
  assertEquals(r.items.map((i) => i.slides), [[2], [3], [4], []]);
  assertEquals(r.items[2].terms.map((t) => t.term), [
    "lactate and pfk-1.1",
  ]);
  const { issues } = lintDeck(slidesOf(LO(SAME)));
  assertEquals(issues.map((i) => `${i.slide}:${i.id}`), ["1:lo-uncovered"]);
  assertStringIncludes(issues[0].message, "outcome 4 (glycation chemistry)");
});

Deno.test("learning outcomes: an edited outcome is lo-mismatch at the closing slide", () => {
  const changed = "2. Name the **ten enzymes**.";
  const { issues, outcomes } = lintDeck(slidesOf(LO(changed), "close.qmd"));
  assertEquals(outcomes!.match, false);
  const mm = issues.filter((i) => i.id === "lo-mismatch");
  assertEquals(mm.length, 1);
  assertEquals(mm[0].slide, 5);
  assertEquals(mm[0].level, "rule");
  assertStringIncludes(mm[0].message, "item 2 differs");
  assertStringIncludes(mm[0].message, "close.qmd:");
});

Deno.test("learning outcomes: a missing item and the .lo classes alone are enough", () => {
  const deck = `## Aims

::: {.lo}
1. One **alpha**.
2. Two **beta**.
:::

## Alpha and beta

## Looking back

::: {.lo-done}
1. One **alpha**.
:::
`;
  const r = learningOutcomes(slidesOf(deck))!;
  assertEquals([r.opening, r.closing, r.match], [1, 3, false]);
  assertEquals(r.differences, ["item 2 only in the opening list"]);
  assertEquals(r.items.map((i) => i.slides), [[2], [2]]);
  assertEquals(learningOutcomes(slidesOf("## Nothing here\n")), null);
});

Deno.test("mentions matches content words as prefixes; termParts splits lists", () => {
  assertEquals(
    mentions("Ten enzymes in glycolysis", "ten glycolytic enzymes"),
    true,
  );
  assertEquals(mentions("HK2 phosphorylates glucose", "HK2"), true);
  assertEquals(mentions("HK20 is not a thing", "HK2"), true); // prefix match, by design
  assertEquals(mentions("Ca2+ rises", "Ca2+"), true);
  assertEquals(mentions("nothing", "glycation"), false);
  assertEquals(termParts("HK1, HK2 and HK3"), [
    "HK1",
    "HK2",
    "HK3",
  ]);
  assertEquals(termParts("lactate and pfk-1.1"), [
    "lactate",
    "pfk-1.1",
  ]);
});

// --- cut view ---------------------------------------------------------------

Deno.test("cutView gives share of slot, three longest slides and the total over", () => {
  const deck = `## Open

::: notes
~2'.
:::

# Part A

## A1

::: notes
~5'.
:::

## A2

::: notes
~3'.
:::

## A3 {visibility="hidden"}

::: notes
~9'.
:::

## A4

::: notes
~1'.
:::

## A5

::: notes
~4'.
:::
`;
  const c = cutView(slidesOf(deck), 10);
  assertEquals(c.minutesPlanned, 15);
  assertEquals(c.overSlot, 5);
  assertEquals(c.sections.map((s) => [s.title, s.minutes, s.share]), [
    ["Opening", 2, 0.2],
    ["Part A", 13, 1.3],
  ]);
  assertEquals(c.sections[1].longest.map((l) => l.title), ["A1", "A5", "A2"]);
  const lines = cutLines(c);
  assertStringIncludes(lines[0], "5 min over");
  assertStringIncludes(lines[2], "130% of slot");
  assertEquals(cutView(slidesOf(deck)).overSlot, null);
});

// --- diagram patterns -------------------------------------------------------

/** Lint a generated slide; returns the findings. */
function lintSlide(md: string) {
  const parsed = parseQmd(src(md));
  return { ...lintDeck(parsed.slides), slides: parsed.slides };
}

/** The pattern contract: no blank line in the svg, no small text, fragments. */
function assertDiagram(svg: string, fragments: number) {
  assertEquals(svg.split("\n").some((l) => l.trim() === ""), false);
  for (const m of svg.matchAll(/font-size="(\d+)"/g)) {
    assertEquals(Number(m[1]) >= 16, true, `font-size ${m[1]}`);
  }
  assertEquals(
    [...svg.matchAll(/<g class="fragment" data-fragment-index="(\d+)">/g)].map(
      (m) => Number(m[1]),
    ),
    Array.from({ length: fragments }, (_, i) => i + 1),
  );
  assertStringIncludes(svg, 'class="diagram" viewBox="0 0 1180 470"');
}

const COMPARE = {
  left: {
    heading: "with LDHA",
    role: "good" as const,
    steps: ["pyruvate reduced to lactate", "glycolysis keeps running"],
    outcome: "normal ATP supply",
  },
  right: {
    heading: "without LDHA",
    role: "bad" as const,
    steps: ["pyruvate accumulates", "glycolysis slows"],
    outcome: "less ATP, more pyruvate",
    detail: "cells lean on respiration",
  },
  bottom:
    "LDHA keeps glycolysis running, so muscle cells can make ATP without much oxygen.",
};

Deno.test("compare_two: two panels and a bottom line on three clicks, brand colours", () => {
  const svg = compareTwoSvg(COMPARE, WUR);
  assertDiagram(svg, 3);
  assertStringIncludes(svg, "#2E7D32");
  assertStringIncludes(svg, "#C0392B");
  assertStringIncludes(svg, 'fill="#12384A"');
  // the take-home line loses its full stop, so it does not read as narration
  assertStringIncludes(svg, "without much oxygen</text>");
  assertDiagram(
    compareTwoSvg({ ...COMPARE, bottom: undefined, build: false }),
    0,
  );
});

Deno.test("claim_vs_data: 1-3 cards, one click each", () => {
  for (const n of [1, 2, 3]) {
    const cards = Array.from({ length: n }, (_, i) => ({
      claim: `lactate causes muscle soreness ${i}`,
      measurement: "blood lactate is back to baseline within an hour",
      detail: "soreness peaks one to two days later",
    }));
    const svg = claimVsDataSvg({ cards });
    assertDiagram(svg, n);
    assertEquals((svg.match(/>the claim</g) ?? []).length, n);
  }
});

Deno.test("chain: boxes with labelled arrows, then result rows, on clicks", () => {
  const svg = chainSvg({
    boxes: [{ label: "AMP rises" }, { label: "AMPK active", role: "good" }, {
      label: "ACC phosphorylated",
      sub: "Ser79",
    }],
    arrows: ["binds gamma", "phosphorylates"],
    results: [{ text: "fatty-acid oxidation up", role: "good" }, {
      text: "lipid synthesis down",
      role: "bad",
    }],
  });
  assertDiagram(svg, 4);
  assertStringIncludes(svg, ">binds gamma</text>");
});

Deno.test("fitText wraps and shrinks but never below 16", () => {
  const f = fitText("a ".repeat(200), 27, 200, 2);
  assertEquals(f.size, 16);
  const g = fitText("short", 27, 500, 1);
  assertEquals([g.lines, g.size], [["short"], 27]);
});

Deno.test("statement_image: background right, white text left, bold highlighted", () => {
  const dflt = statementImageBody({ image: "a.png", lines: ["x"] }, WUR);
  assertStringIncludes(dflt.heading, 'background-color="#12384A"');
  const b = statementImageBody({
    image: "assets/tumour.png",
    lines: [
      "If blocking an **enzyme** slows a tumour,",
      "could a **molecule** do the same?",
    ],
    background: "#385129",
  }, WUR);
  assertStringIncludes(
    b.heading,
    'background-size="auto 100%" background-position="right center"',
  );
  assertStringIncludes(b.heading, ".statement");
  assertStringIncludes(b.body, "color: #FFFFFF !important");
  assertStringIncludes(
    b.body,
    '<b style="color: #CFE8C4 !important;">enzyme</b>',
  );
});

const SPECS: Record<string, unknown> = {
  compare_two: COMPARE,
  claim_vs_data: {
    cards: [{
      claim: "lactate causes muscle soreness",
      measurement: "blood lactate is back to baseline within an hour",
    }],
  },
  chain: {
    boxes: [{ label: "a" }, { label: "b" }, { label: "c" }],
    arrows: ["x", "y"],
  },
  statement_image: {
    image: "assets/x.png",
    lines: ["could a **molecule** do the same?"],
  },
};

Deno.test("every pattern writes a slide that passes the lint (no rules, no hints)", () => {
  for (const kind of PATTERN_KINDS) {
    const md = patternSlide(kind, SPECS[kind], {
      title: "LDHA keeps glycolysis running",
      minutes: 1.5,
      notes: "Build the left panel, then the right.",
      citation: kind === "statement_image"
        ? undefined
        : "Moreau et al. 2019, Cell Metab 29:101",
      reference:
        "Moreau AB et al. Cell Metab 29:101 (2019), doi:10.1234/cmet.2019.0101",
    });
    const r = lintSlide(md);
    assertEquals(r.slides.length, 1, kind);
    assertEquals(r.issues, [], `${kind}: ${JSON.stringify(r.issues)}`);
    assertEquals(r.slides[0].minutes, 1.5, kind);
  }
});

// --- slide_add + report -----------------------------------------------------

function ctx(dir: string) {
  const store = new Map<string, Record<string, unknown>>();
  return {
    store,
    ctx: {
      globalArgs: {
        dir,
        main: "talk.qmd",
        slotMinutes: 5,
        chrome: "chrome",
        quarto: "quarto",
        sourcesDir: "sources",
        assetsDir: "assets",
      },
      logger: { info: () => {} },
      writeResource: (
        _s: string,
        name: string,
        data: Record<string, unknown>,
      ) => {
        store.set(name, structuredClone(data));
        return Promise.resolve({ name });
      },
      readResource: (name: string) => Promise.resolve(store.get(name) ?? null),
      createFileWriter: () => {
        throw new Error("not used");
      },
    },
  };
}
// deno-lint-ignore no-explicit-any
const run = (m: string, args: unknown, c: unknown) =>
  (model.methods as any)[m].execute(args, c);

Deno.test("slide_add writes each pattern, validates the spec, refuses duplicates", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qd-lint-" });
  const f = ctx(dir);
  for (const kind of PATTERN_KINDS) {
    await run("slide_add", {
      kind,
      // the CLI passes JSON text; objects work too
      spec: kind === "chain" ? JSON.stringify(SPECS[kind]) : SPECS[kind],
      file: "part.qmd",
      title: `pattern ${kind}`,
      minutes: 1,
      notes: "Say it.",
    }, f.ctx);
  }
  const text = await Deno.readTextFile(`${dir}/part.qmd`);
  assertStringIncludes(text, "## pattern compare_two");
  assertStringIncludes(text, "## {.statement .sm background-image=");
  assertEquals(
    (f.store.get("journal")!.entries as unknown[]).length,
    PATTERN_KINDS.length,
  );
  await assertRejects(
    () =>
      run("slide_add", {
        kind: "chain",
        spec: { boxes: [{ label: "only one" }] },
        file: "part.qmd",
        title: "bad",
        minutes: 1,
        notes: "",
      }, f.ctx),
    Error,
    "chain spec: boxes",
  );
  await assertRejects(
    () =>
      run("slide_add", {
        kind: "chain",
        spec: SPECS.chain,
        file: "part.qmd",
        title: "pattern chain",
        minutes: 1,
        notes: "",
      }, f.ctx),
    Error,
    "already has",
  );
  await Deno.remove(dir, { recursive: true });
});

Deno.test("report shows where the time goes, suppressed findings and outcomes", () => {
  const o = outlineFromSlides(
    "m.qmd",
    ["m.qmd"],
    parseQmd(src(PRESS + LO(SAME))),
    {
      slotMinutes: 5,
    },
  );
  const r = summarize({ outline: { ...o }, figures: [], sources: [] });
  assertStringIncludes(r.markdown, "### Where the time goes");
  assertStringIncludes(r.markdown, "Cut **");
  assertStringIncludes(r.markdown, "suppressed with lint-ignore (2)");
  assertStringIncludes(r.markdown, "## Learning outcomes");
  assertStringIncludes(r.markdown, "Opening and closing lists match.");
  assertEquals(r.json.styleSuppressed, 2);
});

Deno.test("cutView groups by file when the deck has no # sections", () => {
  const a = src("## A1\n\n::: notes\n~2'.\n:::\n", "glyc/_00_open.qmd");
  const b = src(
    "## B1\n\n::: notes\n~3'.\n:::\n\n## B2\n\n::: notes\n~1'.\n:::\n",
    "glyc/_01_enzymes.qmd",
  );
  const c = cutView(parseQmd([...a, ...b]).slides, 4);
  assertEquals(c.sections.map((s) => [s.title, s.slides, s.minutes]), [
    ["glyc/_00_open.qmd", 1, 2],
    ["glyc/_01_enzymes.qmd", 2, 4],
  ]);
  assertEquals(c.sections[1].share, 1);
});
