import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { type RepoLike, report, summarize } from "./deck_summary_report.ts";

const enc = new TextEncoder();

/** In-memory repository: name → list of (version, content). */
function repo(items: Record<string, Array<[number, string]>>): RepoLike {
  return {
    findAllForModel: () =>
      Promise.resolve(
        Object.entries(items).flatMap(([name, vs]) => vs.map(([version]) => ({ name, version }))),
      ),
    getContent: (_t, _m, name, version) => {
      const hit = items[name]?.find(([v]) => v === version);
      return Promise.resolve(hit ? enc.encode(hit[1]) : null);
    },
  };
}

const OUTLINE = {
  title: "Talk",
  visibleSlides: 10,
  hiddenSlides: 1,
  minutesPlanned: 36,
  slotMinutes: 35,
  notesCoverage: 0.9,
  untimedVisible: [],
  checks: [{ slide: 2, file: "a.qmd", text: "credit line" }],
  missingImages: [],
  dois: ["10.1/x"],
  slides: [{ n: 2, title: "Slide two", hidden: false, minutes: 1 }],
};

Deno.test("summarize reports budget, CHECKs, provenance and journal", () => {
  const r = summarize({
    outline: OUTLINE,
    figures: [{
      path: "assets/h/t.png",
      citation: "S 1959",
      page: 3,
      boxPt: { x: 1, y: 2, w: 3, h: 4 },
      dpi: 200,
      doi: "10.1/x",
    }],
    sources: [],
    journal: { entries: [{ at: "2026-10-22T10:00:00Z", kind: "decision", text: "cut Pasteur" }] },
  });
  assertStringIncludes(r.markdown, "**1.0 min over**");
  assertStringIncludes(r.markdown, "credit line");
  assertStringIncludes(r.markdown, "| `assets/h/t.png` | S 1959 | 3 |");
  assertStringIncludes(r.markdown, "**decision**: cut Pasteur");
  assertEquals(r.json.figures, 1);
});

Deno.test("summarize with no data still returns a valid page", () => {
  const r = summarize({ figures: [], sources: [] });
  assertStringIncludes(r.markdown, "# Deck — summary");
  assertEquals(r.json, { sources: 0 });
});

Deno.test("report reads the latest version of each item", async () => {
  const r = await report.execute({
    modelType: "@vcjdeboer/quarto-deck/deck",
    modelId: "m",
    dataRepository: repo({
      outline: [[1, JSON.stringify({ ...OUTLINE, minutesPlanned: 50 })], [2, JSON.stringify(OUTLINE)]],
    }),
  });
  assertStringIncludes(r.markdown, "36 min planned");
});

Deno.test("report skips corrupt or missing content instead of failing", async () => {
  const r = await report.execute({
    modelType: "@vcjdeboer/quarto-deck/deck",
    modelId: "m",
    dataRepository: repo({ outline: [[1, "{not json"]], journal: [] }),
  });
  assertStringIncludes(r.markdown, "# Deck — summary");
});

Deno.test("report is empty for other model types", async () => {
  const r = await report.execute({
    modelType: "@someone/else",
    modelId: "m",
    dataRepository: repo({}),
  });
  assertEquals(r, { markdown: "", json: {} });
});
