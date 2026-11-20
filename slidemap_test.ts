import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { parseQmd, type SourceLine } from "./outline.ts";
import {
  agreementNotes,
  buildSlideMap,
  clip,
  compareWithHtml,
  dedupeIds,
  displayTitle,
  findSlide,
  formatSlideMap,
  htmlSlideIds,
  pandocId,
  selectRows,
  slideKind,
  type SlideMapContext,
  slideMapMethods,
  type SlideMapRow,
  titleLine,
} from "./slidemap.ts";

const src = (text: string, file = "main.qmd"): SourceLine[] =>
  text.split("\n").map((t, i) => ({ file, line: i + 1, text: t }));

const NOTES = "::: notes\n~1'. x\n:::";

const DECK = [
  "---",
  'title: "Lactate"',
  "format: revealjs",
  "---",
  "",
  "## Learning outcomes", // 6
  "",
  "- one",
  NOTES,
  "",
  '## {.plain background-color="#12384A"}', // 13
  '<svg class="diagram" aria-label="Section overview, now on section 1: Why"><text>1. Why</text></svg>',
  "",
  "# Mitochondria", // 16
  "",
  '## Hidden one {visibility="hidden"}', // 18
  "x",
  "",
  "## {.statement .center}", // 21
  "",
  "What does **PKM2** do in a whole animal?",
  "",
  "## Exercise: seven enzymes", // 25
  "",
  "::: {.task}",
  "Fill every box.",
  ":::",
  "",
  "## A paper finding", // 31
  "![](assets/fig.png)",
  "[Smith 2020]{.src}",
  "",
  '## {background-image="assets/bg.png"}', // 35
  "",
].join("\n");

const rows = (): SlideMapRow[] => buildSlideMap(src(DECK), "main.qmd");

Deno.test("clip shortens on a word boundary with an ellipsis", () => {
  assertEquals(clip("short"), "short");
  assertEquals(clip("one two three four five", 16), "one two three…");
  assertEquals(clip("abcdefghijklmnop qr", 10), "abcdefghi…");
  assertEquals(clip("a  b\n c"), "a b c");
});

Deno.test("pandocId matches the ids Quarto writes", () => {
  assertEquals(
    pandocId("Glycolysis couples the cell's H+ to its ATP"),
    "glycolysis-couples-the-cells-h-to-its-atp",
  );
  assertEquals(
    pandocId("Muscle: no effect. Liver: small, and also without pfk-1.1"),
    "muscle-no-effect.-liver-small-and-also-without-pfk-1.1",
  );
  assertEquals(
    pandocId("Lean/obese mice with and without LDHA"),
    "leanobese-mice-with-and-without-ldha",
  );
  assertEquals(pandocId('{.plain background-color="#12384A"}'), "section");
  assertEquals(pandocId("2024: a **bold** year {.x}"), "a-bold-year");
  assertEquals(pandocId("Anything {#my-id .statement}"), "my-id");
});

Deno.test("dedupeIds numbers repeats like pandoc", () => {
  assertEquals(
    dedupeIds(["section", "a", "section", "section", "a"]),
    ["section", "a", "section-1", "section-2", "a-1"],
  );
});

Deno.test("titleLine finds the title in the front matter", () => {
  assertEquals(titleLine(src(DECK), "main.qmd"), 2);
  assertEquals(titleLine(src("## x"), "main.qmd"), 1);
});

Deno.test("buildSlideMap numbers slides as the counter does", () => {
  const r = rows();
  assertEquals(r.map((x) => x.shown), [1, 2, 3, 4, null, 5, 6, 7, 8]);
  assertEquals(r[0], {
    shown: 1,
    source: 0,
    title: "Lactate",
    kind: "title",
    hidden: false,
    file: "main.qmd",
    line: 2,
    section: "Opening",
    minutes: null,
    id: "title-slide",
  });
  assertEquals(r[1].minutes, 1);
  assertEquals(r[4].hidden, true);
  assertEquals(r[4].kind, "content");
  assertEquals(r.map((x) => x.section), [
    "Opening",
    "Opening",
    "Opening",
    "Mitochondria",
    "Mitochondria",
    "Mitochondria",
    "Mitochondria",
    "Mitochondria",
    "Mitochondria",
  ]);
  assertEquals(r.map((x) => x.id), [
    "title-slide",
    "learning-outcomes",
    "section",
    "mitochondria",
    "hidden-one",
    "section-1",
    "exercise-seven-enzymes",
    "a-paper-finding",
    "section-2",
  ]);
  assertEquals(r.map((x) => x.line), [2, 6, 13, 16, 18, 21, 25, 31, 35]);
});

Deno.test("buildSlideMap without a title has no title slide", () => {
  const r = buildSlideMap(src("## A\n\n## B"), "main.qmd");
  assertEquals(r.map((x) => [x.shown, x.title]), [[1, "A"], [2, "B"]]);
});

Deno.test("kinds and display titles", () => {
  const r = rows();
  assertEquals(r.map((x) => x.kind), [
    "title",
    "content",
    "plain",
    "section",
    "content",
    "statement",
    "exercise",
    "paper",
    "image",
  ]);
  assertEquals(r[2].title, "Section overview, now on section 1: Why");
  assertEquals(r[5].title, "What does PKM2 do in a whole animal?");
  assertEquals(r[8].title, "[image]");
});

Deno.test("rows keep long heading titles whole; the printed table clips them", () => {
  const long =
    "Fasted PKM2 knockout mice cannot hold their core temperature in the cold";
  const r = buildSlideMap(
    src(`---\ntitle: "${long} (deck)"\n---\n\n## ${long}\n`),
    "main.qmd",
  );
  assertEquals(r[0].title, `${long} (deck)`);
  assertEquals(r[1].title, long); // same text as the HTML and export_pdf titles
  const line = formatSlideMap(r).split("\n").find((l) =>
    l.includes("main.qmd:5")
  )!;
  assertEquals(line.endsWith("…"), true);
});

Deno.test("displayTitle falls back to section divider and untitled", () => {
  const { slides } = parseQmd(src("# {.x}\n\n## {.y}\n"));
  assertEquals(displayTitle(slides[0]), "[section divider]");
  assertEquals(displayTitle(slides[1]), "[untitled]");
  assertEquals(slideKind(slides[0]), "section");
  const html = parseQmd(src(
    '## {.statement background-image="a.png"}\n\n<div>\n<p>If a <b>gene</b>,</p>\n<p>could a molecule?</p>\n</div>',
  )).slides[0];
  assertEquals(displayTitle(html), "If a gene, could a molecule?");
});

Deno.test("slideKind: a diagram with a .src line is a diagram, not a paper", () => {
  const SRC = "[Hirschey et al., Nature 2010]{.src}";
  const rows = buildSlideMap(
    src(
      [
        "## Paper\n\n![](fig.png)\n\n" + SRC,
        '## Model\n\n<svg viewBox="0 0 10 10" aria-label="m"></svg>\n\n' + SRC,
        '## Drawn\n\n<svg viewBox="0 0 10 10"></svg>',
      ].join("\n\n"),
    ),
    "main.qmd",
  );
  assertEquals(rows.map((r) => r.kind), ["paper", "diagram", "diagram"]);
});

Deno.test("htmlSlideIds reads slide sections in order", () => {
  const html = `<section id="title-slide" class="quarto-title-block">
    <section id="a" class="slide level2"><svg><section></section></svg></section>
    <section><section id="b" class="slide level2 plain"></section></section>
    <section id="not-a-slide" class="footer"></section>`;
  assertEquals(htmlSlideIds(html), ["title-slide", "a", "b"]);
});

Deno.test("compareWithHtml reports count and id disagreements", () => {
  const r = rows();
  const ids = r.filter((x) => x.shown !== null).map((x) => x.id);
  assertEquals(compareWithHtml(r, ids).agrees, true);
  const off = compareWithHtml(r, ["title-slide", ...ids.slice(2)]);
  assertEquals(off.agrees, false);
  assertEquals(off.htmlSlides, 7);
  assertEquals(off.shownSlides, 8);
  assertEquals(off.mismatches[0], {
    shown: 2,
    expected: "learning-outcomes",
    actual: "section",
  });
  assertEquals(off.mismatches.at(-1), {
    shown: 8,
    expected: "section-2",
    actual: "(none)",
  });
});

Deno.test("agreementNotes explains disagreement", () => {
  const base = {
    html: "/d/main.html",
    exists: true,
    stale: false,
    htmlSlides: 3,
    shownSlides: 3,
    agrees: true,
    mismatches: [],
  };
  assertEquals(agreementNotes(base), []);
  assertEquals(agreementNotes({ ...base, exists: false }).length, 1);
  const notes = agreementNotes({
    ...base,
    stale: true,
    htmlSlides: 2,
    agrees: false,
    mismatches: [{ shown: 3, expected: "x", actual: "(none)" }],
  });
  assertEquals(notes, [
    "/d/main.html is older than the source; render to refresh",
    "source gives 3 shown slides, the HTML has 2",
    "slide 3: source expects #x, HTML has #(none)",
  ]);
});

Deno.test("selectRows filters by title and around a number", () => {
  const r = rows();
  assertEquals(selectRows(r, { query: "PAPER" }).map((x) => x.shown), [7]);
  // around 4: shown 1..7, the hidden row between 4 and 5 kept
  assertEquals(
    selectRows(r, { around: 4 }).map((x) => x.shown),
    [1, 2, 3, 4, null, 5, 6, 7],
  );
  assertEquals(selectRows(r, { around: 8 }).map((x) => x.shown), [5, 6, 7, 8]);
  assertEquals(selectRows(r, { around: 50 }), []);
  assertEquals(selectRows(r).length, r.length);
});

Deno.test("formatSlideMap prints sections, hidden rows and locations", () => {
  const t = formatSlideMap(rows()).split("\n");
  assertEquals(t[1], "--- Opening");
  assertEquals(t.some((l) => l === "--- Mitochondria"), true);
  const hidden = t.find((l) => l.includes("Hidden one"))!;
  assertEquals(
    /^\s+-\s+hidden\s+main\.qmd:18\s+Hidden one$/.test(hidden),
    true,
  );
  const lo = t.find((l) => l.includes("Learning outcomes"))!;
  assertEquals(/^\s+2\s+content\s+1\s+main\.qmd:6\s+/.test(lo), true);
});

Deno.test("findSlide by number or title", () => {
  const r = rows();
  assertEquals(findSlide(r, { n: 7 }).row.title, "A paper finding");
  assertThrows(() => findSlide(r, { n: 9 }), Error, "shows 1–8");
  const t = findSlide(r, { title: "o" });
  assertEquals(t.row.shown, 2);
  assertEquals(t.others.length > 0, true);
  assertThrows(
    () => findSlide(r, { title: "hidden one" }),
    Error,
    "only hidden",
  );
  assertThrows(() => findSlide(r, { title: "zzz" }), Error, "no slide title");
  assertThrows(() => findSlide(r, {}), Error, "give n");
});

Deno.test("slide_map method writes the map and prints the table", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/main.qmd`, DECK);
    const ids = rows().filter((x) => x.shown !== null).map((x) =>
      `<section id="${x.id}" class="slide level2"></section>`
    );
    await Deno.writeTextFile(`${dir}/main.html`, ids.join("\n"));
    const logs: string[] = [];
    const written: Array<{ spec: string; data: Record<string, unknown> }> = [];
    const ctx: SlideMapContext = {
      globalArgs: { dir, main: "main.qmd" },
      logger: {
        info: (msg, props) =>
          logs.push(
            msg.replace(/\{(\w+)\}/g, (_, k) => String(props?.[k] ?? "")),
          ),
      },
      writeResource: (spec, _name, data) => {
        written.push({ spec, data });
        return Promise.resolve({ name: spec });
      },
      createFileWriter: () => {
        throw new Error("not used");
      },
    };
    await slideMapMethods.slide_map.execute({ around: 7 }, ctx);
    assertEquals(written[0].spec, "slideMap");
    assertEquals(written[0].data.shownSlides, 8);
    assertEquals(written[0].data.hiddenSlides, 1);
    assertEquals((written[0].data.html as { agrees: boolean }).agrees, true);
    assertEquals(logs.some((l) => l.includes("A paper finding")), true);
    assertEquals(logs.some((l) => l.includes("Learning outcomes")), false);
    assertEquals(
      logs.some((l) => l.startsWith("8 shown slides (+1 hidden); HTML agrees")),
      true,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
