import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { htmlPath, model } from "./quarto_deck.ts";
import { overflowing, sheetPages } from "./check.ts";
import { quartzFilterPlist } from "./pdf.ts";
import { warningsFromLog } from "./render.ts";

Deno.test("model exposes the deck methods", () => {
  assertEquals(model.type, "@vcjdeboer/quarto-deck/deck");
  for (const m of Object.keys(model.methods) as Array<keyof typeof model.methods>) {
    assertEquals(typeof model.methods[m].execute, "function");
  }
});

Deno.test("htmlPath swaps the source extension", () => {
  assertEquals(htmlPath("/d/", "talk.qmd"), "/d/talk.html");
  assertEquals(htmlPath("/d", "talk.Rmd"), "/d/talk.html");
});

Deno.test("sheetPages groups slides per sheet", () => {
  assertEquals(sheetPages(5, 2), [[1, 2], [3, 4], [5]]);
  assertEquals(sheetPages(0, 12), []);
});

Deno.test("overflowing applies the tolerance", () => {
  const s = (n: number, px: number) => ({
    n,
    h: 0,
    v: 0,
    title: "",
    fragments: 0,
    overflowPx: px,
    overflowElement: "",
  });
  assertEquals(overflowing([s(1, 2), s(2, 3)]).map((x) => x.n), [2]);
});

Deno.test("quartzFilterPlist carries the settings", () => {
  const p = quartzFilterPlist({ quality: 0.6, dpi: 144.4, maxPx: 1200 });
  assertStringIncludes(p, "<real>0.6</real>");
  assertStringIncludes(p, "<integer>144</integer>");
  assertStringIncludes(p, "<integer>1200</integer>");
});

Deno.test("warningsFromLog keeps warning lines only", () => {
  assertEquals(warningsFromLog("ok\nWARN: x\nfine\nWarning: y"), ["WARN: x", "Warning: y"]);
});
