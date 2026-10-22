import { assertEquals } from "jsr:@std/assert@1";
import {
  cleanDoi,
  imagesInLine,
  outlineFromSlides,
  parseHeading,
  parseMinutes,
  parseQmd,
  type SourceLine,
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
