import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { countSteps, parseQmd, type SourceLine, styleIssues } from "./outline.ts";
import { inkBounds, parsePpm, trimmedBox } from "./sources.ts";
import { isKeynote } from "./pptx.ts";

const src = (text: string): SourceLine[] =>
  text.split("\n").map((t, i) => ({ file: "a.qmd", line: i + 1, text: t }));

Deno.test("countSteps counts animation steps, not text builds", () => {
  assertEquals(countSteps("[a]{.fragment .step} [b]{.fragment} [c]{.step .fragment}"), 2);
});

const DECK = `## Good paper slide

![](a.png)

[Smith, Nature 2020]{.src}

::: notes
~1'. Talk. Ref: Smith 2020, doi:10.1/x.
:::

## Busy paper slide

![](a.png)

![](b.png)

[Smith 2020]{.src} [Jones 2019]{.src}

[point]{.fragment}

::: notes
Talk without timing.
:::

## Animated slide

![](c.png)

[Lee 2021]{.src}

[x]{.fragment .step}

::: notes
~1'. Ref: Lee 2021.
:::

## No notes
`;

Deno.test("styleIssues applies the house rules and keeps DOI as a hint", () => {
  const issues = styleIssues(parseQmd(src(DECK)).slides);
  const got = issues.map((i) => `${i.slide}:${i.rule}:${i.level}`);
  assertEquals(got, [
    "2:one-figure:rule",
    "2:one-source:rule",
    "2:no-builds:rule",
    "2:timing:rule",
    "2:doi:hint",
    "4:notes:rule",
  ]);
});

Deno.test("styleIssues ignores hidden slides", () => {
  const issues = styleIssues(parseQmd(src('## Hidden {visibility="hidden"}\n')).slides);
  assertEquals(issues, []);
});

/** Tiny PPM: white with one dark pixel block. */
function ppm(w: number, h: number, dark: Array<[number, number]>): Uint8Array {
  const head = new TextEncoder().encode(`P6\n# c\n${w} ${h}\n255\n`);
  const data = new Uint8Array(w * h * 3).fill(255);
  for (const [x, y] of dark) data.fill(0, (y * w + x) * 3, (y * w + x) * 3 + 3);
  const out = new Uint8Array(head.length + data.length);
  out.set(head);
  out.set(data, head.length);
  return out;
}

Deno.test("parsePpm and inkBounds find the dark pixels", () => {
  const img = parsePpm(ppm(10, 8, [[2, 3], [6, 5]]));
  assertEquals([img.width, img.height], [10, 8]);
  assertEquals(inkBounds(img), { x0: 2, y0: 3, x1: 6, y1: 5 });
  assertEquals(inkBounds(parsePpm(ppm(4, 4, []))), null);
});

Deno.test("parsePpm rejects other formats", () => {
  assertThrows(() => parsePpm(new TextEncoder().encode("P3\n1 1\n255\n0 0 0")));
});

Deno.test("trimmedBox shrinks to ink plus padding, never beyond the box", () => {
  const box = { x: 100, y: 200, w: 100, h: 100 };
  // at 72 dpi one pixel is one point
  assertEquals(trimmedBox(box, { x0: 10, y0: 20, x1: 49, y1: 59 }, 72, 4), {
    x: 106,
    y: 216,
    w: 48,
    h: 48,
  });
  assertEquals(trimmedBox(box, { x0: 0, y0: 0, x1: 99, y1: 99 }, 72, 4), box);
});

Deno.test("isKeynote detects .key files and packages", () => {
  assertEquals(isKeynote("/a/talk.key"), true);
  assertEquals(isKeynote("/a/talk.KEY/"), true);
  assertEquals(isKeynote("/a/talk.pptx"), false);
});

Deno.test("sectionTimes splits planned minutes per section, skipping hidden", async () => {
  const { sectionTimes } = await import("./outline.ts");
  const deck = `## Hello

::: notes
~1'.
:::

# Part A

## A1

::: notes
~2'.
:::

## A2 {visibility="hidden"}

::: notes
~5'.
:::

# Part B

## B1

::: notes
~30 s.
:::
`;
  assertEquals(sectionTimes(parseQmd(src(deck)).slides), [
    { title: "Opening", slide: null, slides: 1, minutes: 1 },
    { title: "Part A", slide: 2, slides: 2, minutes: 2 },
    { title: "Part B", slide: 5, slides: 2, minutes: 0.5 },
  ]);
});
