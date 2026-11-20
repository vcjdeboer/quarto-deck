import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  checkSuffix,
  countPdfPages,
  pagesHtml,
  parseSplit,
  partFileName,
  planParts,
  repeatedPages,
  sectionStarts,
  verifyParts,
} from "./export.ts";

Deno.test("parseSplit: none, sections, at:, lists", () => {
  assertEquals(parseSplit(undefined), { mode: "none" });
  assertEquals(parseSplit(""), { mode: "none" });
  assertEquals(parseSplit("sections"), { mode: "sections" });
  assertEquals(parseSplit("at:50"), { mode: "pages", starts: [50] });
  assertEquals(parseSplit("at:30, 60"), { mode: "pages", starts: [30, 60] });
  assertEquals(parseSplit("1,30"), { mode: "pages", starts: [1, 30] });
  assertEquals(parseSplit("[1,30]"), { mode: "pages", starts: [1, 30] });
  assertEquals(parseSplit([1, 40]), { mode: "pages", starts: [1, 40] });
  assertThrows(() => parseSplit("at:x"));
  assertThrows(() => parseSplit("half"));
  assertThrows(() => parseSplit([0]));
});

Deno.test("planParts: page 1 always starts, sorted, deduplicated, inclusive ends", () => {
  assertEquals(planParts(81, [50]), [
    { part: 1, from: 1, to: 49 },
    { part: 2, from: 50, to: 81 },
  ]);
  assertEquals(planParts(10, []), [{ part: 1, from: 1, to: 10 }]);
  assertEquals(planParts(10, [8, 1, 4, 4]), [
    { part: 1, from: 1, to: 3 },
    { part: 2, from: 4, to: 7 },
    { part: 3, from: 8, to: 10 },
  ]);
  assertEquals(planParts(10, [10]).at(-1), { part: 2, from: 10, to: 10 });
  assertThrows(() => planParts(10, [11]), Error, "beyond the last slide");
  assertThrows(() => planParts(0, []));
});

Deno.test("sectionStarts drops a divider right after the title slide", () => {
  assertEquals(sectionStarts([2, 7, 15]), [7, 15]);
  assertEquals(sectionStarts([4, 11]), [4, 11]);
  assertEquals(sectionStarts([]), []);
});

Deno.test("partFileName and checkSuffix", () => {
  assertEquals(partFileName("glycolysis", 1, 1), "glycolysis.pdf");
  assertEquals(
    partFileName("glycolysis", 1, 1, "18nov2026"),
    "glycolysis_18nov2026.pdf",
  );
  assertEquals(
    partFileName("glycolysis", 2, 2, "18nov2026"),
    "glycolysis_part2_18nov2026.pdf",
  );
  assertEquals(partFileName("s", 1, 3, undefined, "png"), "s_part1.png");
  assertEquals(checkSuffix("18nov2026"), "18nov2026");
  assertEquals(checkSuffix(""), undefined);
  assertThrows(() => checkSuffix("../x"));
  assertThrows(() => checkSuffix("a b"));
});

Deno.test("pagesHtml: one fixed-size page per image, no break after the last", () => {
  const h = pagesHtml(["p1.png", 'p"2.png'], 1280, 720);
  assertEquals((h.match(/class="page"/g) ?? []).length, 2);
  assertEquals(h.includes("@page{size:1280px 720px;margin:0}"), true);
  assertEquals(h.includes(".page:last-child{break-after:auto"), true);
  assertEquals(h.includes('src="p&#34;2.png"'), true);
});

Deno.test("countPdfPages counts /Type /Page but not /Pages", () => {
  const pdf = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj <</Type /Pages /Count 2>>\n2 0 obj <</Type /Page>>\n3 0 obj <</Type/Page/Parent 1 0 R>>\n",
  );
  assertEquals(countPdfPages(pdf), 2);
});

Deno.test("repeatedPages flags a page identical to the one before", () => {
  assertEquals(repeatedPages(["a", "b", "b", "c", "c", "c"]), [3, 5, 6]);
  assertEquals(repeatedPages(["a"]), []);
});

Deno.test("verifyParts: totals and per-part counts must match the live deck", () => {
  const ok = [
    { part: 1, from: 1, to: 49, pages: 49 },
    { part: 2, from: 50, to: 81, pages: 32 },
  ];
  assertEquals(verifyParts(81, ok), []);
  // the hidden-slide failure: one page short
  assertEquals(verifyParts(81, [{ part: 1, from: 1, to: 81, pages: 80 }]), [
    "part 1: 80 pages, expected 81 (slides 1-81)",
    "80 pages in total, but the deck has 81 slides",
  ]);
  // the print-pdf failure: slides spilling over extra pages
  assertEquals(
    verifyParts(2, [{ part: 1, from: 1, to: 2, pages: 5 }]).length,
    2,
  );
  assertEquals(
    verifyParts(3, [{ part: 1, from: 1, to: 3, pages: null }]).length,
    2,
  );
});
