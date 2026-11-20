import { assertEquals } from "jsr:@std/assert@1";
import {
  cleanDoi,
  frontMatterFiles,
  imagesInLine,
  outlineDeck,
  outlineFromSlides,
  parseHeading,
  parseMinutes,
  parseQmd,
  type SourceLine,
  styleIssues,
} from "./outline.ts";

const src = (text: string, file = "main.qmd"): SourceLine[] =>
  text.split("\n").map((t, i) => ({ file, line: i + 1, text: t }));

Deno.test("parseMinutes reads minutes and seconds", () => {
  assertEquals(parseMinutes("~1.5'. Story"), 1.5);
  assertEquals(parseMinutes("~2'. x"), 2);
  assertEquals(parseMinutes("~45 s. x"), 0.75);
  assertEquals(parseMinutes("no timing"), null);
});

Deno.test("parseHeading splits title, classes and hidden", () => {
  assertEquals(parseHeading('Who are you? {visibility="hidden"}'), {
    title: "Who are you?",
    classes: [],
    hidden: true,
  });
  assertEquals(parseHeading("{.statement .center}"), {
    title: "",
    classes: ["statement", "center"],
    hidden: false,
  });
});

Deno.test("cleanDoi keeps balanced parentheses, drops trailing punctuation", () => {
  assertEquals(cleanDoi("10.1016/S0021-9258(18)70011-2"), "10.1016/S0021-9258(18)70011-2");
  assertEquals(cleanDoi("10.1038/nrc3038."), "10.1038/nrc3038");
  assertEquals(cleanDoi("10.1038/nrc3038)."), "10.1038/nrc3038");
});

Deno.test("imagesInLine finds markdown, img and background images, skips URLs", () => {
  assertEquals(
    imagesInLine('![](a.png){x} <img src="b.jpg"> ![](https://x/y.png)'),
    ["a.png", "b.jpg"],
  );
  assertEquals(imagesInLine('## T {background-image="bg.png"}'), ["bg.png"]);
});

const DECK = `---
title: "Demo"
---

# Part one {.section}

## Paper slide

![](fig.png)

[Smith, Nature 2020]{.src}

::: notes
~1.5'. Story. Ref: doi:10.1000/abc.
CHECK: credit line
## not a slide
:::

## Hidden {visibility="hidden"}

::: {.fragment}
x
:::

\`\`\`r
## not a slide either
\`\`\`

## {.statement}

Big words

::: notes
~30 s.
:::
`;

Deno.test("parseQmd finds slides, notes, timing, src, DOIs and CHECKs", () => {
  const p = parseQmd(src(DECK));
  assertEquals(p.title, "Demo");
  assertEquals(p.slides.map((s) => s.title), ["Part one", "Paper slide", "Hidden", ""]);
  const paper = p.slides[1];
  assertEquals(paper.minutes, 1.5);
  assertEquals(paper.hasNotes, true);
  assertEquals(paper.src, ["Smith, Nature 2020"]);
  assertEquals(paper.dois, ["10.1000/abc"]);
  assertEquals(paper.checks, ["credit line"]);
  assertEquals(paper.images, ["fig.png"]);
  assertEquals(p.slides[2].hidden, true);
  assertEquals(p.slides[2].fragments, 1);
  assertEquals(p.slides[3].minutes, 0.5);
});

Deno.test("outlineFromSlides budgets visible slides and flags missing images", () => {
  const p = parseQmd(src(DECK));
  const o = outlineFromSlides("main.qmd", ["main.qmd"], p, {
    slotMinutes: 30,
    exists: (path) => path !== "fig.png",
  });
  assertEquals(o.visibleSlides, 3);
  assertEquals(o.hiddenSlides, 1);
  assertEquals(o.minutesPlanned, 2);
  assertEquals(o.missingImages, [{ slide: 2, path: "fig.png" }]);
  assertEquals(o.checks.length, 1);
  assertEquals(o.untimedVisible, []);
});

Deno.test("narration rule flags lecturer talk on a slide", () => {
  const { slides } = parseQmd(src(`## The ten steps of glycolysis, and the two we use today

<svg class="diagram" viewBox="0 0 10 10">
  <text x="1" y="1">genome instability</text>
  <text x="2" y="2">Today we open just these two,</text>
</svg>

[Okafor 2021, Trends Biochem Sci, Fig. 1]{.src}

::: notes
~2'. Ref: doi:10.1016/j.arr.2024.102616
:::
`));
  const found = styleIssues(slides).filter((i) => i.rule === "narration");
  const rules = found.filter((i) => i.level === "rule");
  // both the title and the SVG line are caught
  assertEquals(rules.length, 2);
  // the title and the spoken SVG line are both named back to the author
  assertEquals(rules.some((i) => i.message.includes("we use today")), true);
  assertEquals(
    rules.some((i) => i.message.includes("Today we open just these two")),
    true,
  );
});

Deno.test("narration rule flags scaffolding titles and timetable words", () => {
  const cases: Array<[string, string]> = [
    ["## Approach: one bat genome compared with eight mammals", "is scaffolding"],
    ["## Rung 1, yeast: PFK1 sets the glycolytic rate", "is scaffolding"],
    ["## The control: block PFK1 and lactate output returns", "is scaffolding"],
  ];
  for (const [heading, want] of cases) {
    const { slides } = parseQmd(src(`${heading}\n\n::: notes\n~1'. x\n:::\n`));
    const found = styleIssues(slides).filter((i) =>
      i.rule === "narration" && i.level === "rule"
    );
    assertEquals(found.length >= 1, true, heading);
    assertEquals(found[0].message.includes(want), true, heading);
  }
});

Deno.test("titles: a finding or a noun phrase passes, a bare topic word is a hint", () => {
  const ids = (heading: string) =>
    styleIssues(parseQmd(src(`${heading}\n\n::: notes\n~1'. x\n:::\n`)).slides)
      .filter((i) => i.rule === "titles").map((i) => `${i.id}:${i.level}`);
  assertEquals(ids("## Results"), ["topic-title:hint"]);
  assertEquals(ids("## Background:"), ["topic-title:hint"]);
  assertEquals(ids("## Key results"), ["topic-title:hint"]);
  assertEquals(ids("## PKM2 knockout mice in the cold"), []);
  assertEquals(ids("## Fasted PKM2 knockouts cannot hold their temperature"), []);
  assertEquals(ids("## Results of the knockout screen"), []);
});

Deno.test("conclusions as a table is flagged; caveat lines are a hint", () => {
  const ids = (text: string) =>
    styleIssues(parseQmd(src(text)).slides).map((i) => `${i.id}:${i.level}`);
  const N = "\n\n::: notes\n~1'. x\n:::\n";
  assertEquals(
    ids("## Conclusions\n\n| a | b |\n|---|---|\n| 1 | 2 |" + N),
    ["conclusion-table:rule"],
  );
  assertEquals(ids("## Take-home\n\n- one\n- two\n- three" + N), []);
  assertEquals(
    ids("## Conclusions\n\n" + "- x\n".repeat(6) + N),
    ["conclusion-long:hint"],
  );
  assertEquals(
    ids("## PKM2 makes pyruvate from PEP\n\nCaveat: mouse data only" + N),
    ["caveat-line:hint"],
  );
});

Deno.test("narration hint flags a spoken take-home line beside a figure", () => {
  const { slides } = parseQmd(src(`## Four animals, one pathway

<svg class="diagram" viewBox="0 0 10 10">
  <text x="1" y="1">worm</text>
  <text x="1" y="2">Turn the same signal down, live longer.</text>
</svg>

::: notes
~2'. x
:::
`));
  const hints = styleIssues(slides).filter((i) =>
    i.rule === "narration" && i.level === "hint"
  );
  assertEquals(hints.length, 1);
  assertEquals(hints[0].message.includes("spoken line beside a figure"), true);
});

Deno.test("narration rule leaves factual slides and exercise text alone", () => {
  const { slides } = parseQmd(src(`## A mouse without the GH receptor is smaller

![](assets/x.png){.r-stretch}

[Coschigano 2000, Endocrinology, Fig. 1]{.src}

::: notes
~2'. Ref: doi:10.1210/endo.141.7.7586
:::

## Exercise: draw the pathway yourself

::: {.task}
Work alone, three minutes. Then compare with your neighbour.
:::

::: notes
~6'. x
:::
`));
  const found = styleIssues(slides).filter((i) => i.rule === "narration");
  assertEquals(found, []);
});

Deno.test("frontMatterFiles lists header/theme/css/logo files, not built-in themes", () => {
  const fm = [
    "---",
    'title: "x"',
    "format:",
    "  revealjs:",
    "    theme: [default, theme/wur-brand.scss]",
    "    logo: assets/wur-logo.png",
    "    include-in-header: theme/deck-extras.html",
    "    css:",
    "      - a.css",
    '      - "b c.css"',
    "    include-after-body:",
    "      text: <script></script>",
    "---",
    "## slide",
    "include-in-header: not/front/matter.html",
  ].join("\n");
  assertEquals(frontMatterFiles(fm).map((f) => `${f.key}=${f.path}`), [
    "theme=theme/wur-brand.scss",
    "logo=assets/wur-logo.png",
    "include-in-header=theme/deck-extras.html",
    "css=a.css",
    "css=b c.css",
  ]);
  assertEquals(frontMatterFiles("## no front matter"), []);
});

Deno.test("outlineDeck reports a missing include-in-header file (Quarto would paste its name as text)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/theme`);
    await Deno.writeTextFile(`${dir}/theme/brand.scss`, "/*-- scss:defaults --*/");
    await Deno.writeTextFile(
      `${dir}/main.qmd`,
      "---\nformat:\n  revealjs:\n    theme: [default, theme/brand.scss]\n    include-in-header: theme/extras.html\n---\n\n## A\n",
    );
    const o = outlineDeck(dir, "main.qmd");
    assertEquals(o.missingIncludes, ["theme/extras.html (include-in-header)"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
