import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { boxToPoints, findCaptions, pixelCrop, searchPages, slug } from "./sources.ts";
import {
  filterShapes,
  listShapes,
  paragraphs,
  parseRels,
  qmdStub,
  resolvePart,
  setHidden,
  topLevelChildren,
} from "./pptx.ts";
import { insertSlide, paperSlide, sectionSlide, statementSlide, timing } from "./slides.ts";

Deno.test("findCaptions finds figure/table labels, skips running text", () => {
  const caps = findCaptions([
    "intro\nTABLE I\nFig. 2. Oxygen uptake of cells",
    "as shown in Table II below.\nTable 3: Lactate",
  ]);
  assertEquals(caps.map((c) => `${c.page}:${c.label}`), ["1:TABLE I", "1:Fig. 2", "2:Table 3"]);
});

Deno.test("searchPages is case-insensitive and reports pages", () => {
  assertEquals(searchPages(["a\nParticles per cell", "x", "PARTICLES"], "particles"), [
    { page: 1, line: "Particles per cell" },
    { page: 3, line: "PARTICLES" },
  ]);
});

Deno.test("boxToPoints accepts fractions or points and clamps to the page", () => {
  const page = { width: 600, height: 800 };
  assertEquals(boxToPoints({ x: 0.5, y: 0.25, w: 0.5, h: 0.25 }, page), {
    x: 300,
    y: 200,
    w: 300,
    h: 200,
  });
  assertEquals(boxToPoints({ x: 500, y: 700, w: 300, h: 300 }, page), {
    x: 500,
    y: 700,
    w: 100,
    h: 100,
  });
});

Deno.test("pixelCrop scales points to pixels at dpi", () => {
  assertEquals(pixelCrop({ x: 72, y: 36, w: 144, h: 72 }, 200), { x: 200, y: 100, W: 400, H: 200 });
});

Deno.test("slug makes safe file names", () => {
  assertEquals(slug("Fig 2D (right)"), "fig_2d_right");
});

const SLIDE = `<p:sld xmlns:p="p"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
  `<p:txBody><a:p><a:r><a:t>Hello &amp; bye</a:t></a:r></a:p></p:txBody></p:sp>` +
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="7" name="Group 6"/></p:nvGrpSpPr><p:sp><p:nvSpPr><p:cNvPr id="8" name="x"/></p:nvSpPr></p:sp></p:grpSp>` +
  `<p:pic><p:nvPicPr><p:cNvPr id="9" name="Picture 8"/></p:nvPicPr></p:pic>` +
  `</p:spTree></p:cSld><p:timing><p:tnLst/></p:timing></p:sld>`;

Deno.test("topLevelChildren / listShapes see only top-level shapes", () => {
  const inner = SLIDE.slice(SLIDE.indexOf("<p:spTree>") + 10, SLIDE.indexOf("</p:spTree>"));
  assertEquals(topLevelChildren(inner).length, 5);
  assertEquals(listShapes(SLIDE).map((s) => `${s.id}:${s.kind}`), ["2:sp", "7:grpSp", "9:pic"]);
  assertEquals(listShapes(SLIDE)[0].text, "Hello & bye");
});

Deno.test("filterShapes keeps chosen ids and drops timing", () => {
  const out = filterShapes(SLIDE, { keep: ["7"] });
  assertEquals(listShapes(out).map((s) => s.id), ["7"]);
  assertEquals(out.includes("<p:timing>"), false);
  assertEquals(listShapes(filterShapes(SLIDE, { drop: ["2"] })).map((s) => s.id), ["7", "9"]);
});

Deno.test("setHidden toggles show=0", () => {
  const h = setHidden(SLIDE, true);
  assertStringIncludes(h, '<p:sld show="0"');
  assertEquals(setHidden(h, false).includes('show="0"'), false);
});

Deno.test("paragraphs, parseRels and resolvePart", () => {
  assertEquals(paragraphs("<a:p><a:t>a</a:t><a:t>b</a:t></a:p><a:p></a:p>"), ["ab"]);
  const rels = parseRels(
    '<Relationship Id="rId2" Type="http://x/image" Target="../media/image1.png"/>',
  );
  assertEquals(rels.get("rId2")?.target, "../media/image1.png");
  assertEquals(resolvePart("ppt/slides/slide1.xml", "../media/image1.png"), "ppt/media/image1.png");
});

Deno.test("qmdStub writes a slide with notes and a CHECK", () => {
  const md = qmdStub("old", [{
    n: 4,
    part: "",
    title: "Lactate clock",
    text: [],
    notes: "say this",
    hidden: false,
    media: [],
  }], new Map([[4, ["assets/x/old_s04_image1.png"]]]));
  assertStringIncludes(md, "## Lactate clock");
  assertStringIncludes(md, "![](assets/x/old_s04_image1.png)");
  assertStringIncludes(md, "~1'. say this");
  assertStringIncludes(md, "CHECK: ported from old slide 4");
});

Deno.test("timing formats minutes and seconds", () => {
  assertEquals(timing(1.5), "~1.5'");
  assertEquals(timing(2), "~2'");
  assertEquals(timing(0.75), "~45 s");
});

Deno.test("paperSlide follows one paper, one message", () => {
  const md = paperSlide({
    title: "1959: eating needs glycolysis",
    image: "assets/h/t.png",
    citation: "Sbarra & Karnovsky, J Biol Chem 1959",
    minutes: 2,
    notes: "Story.",
    doi: "10.1016/x",
  });
  assertEquals(md.split("\n")[0], "## 1959: eating needs glycolysis");
  assertEquals((md.match(/!\[\]/g) ?? []).length, 1);
  assertEquals((md.match(/\{\.src\}/g) ?? []).length, 1);
  assertEquals(md.includes(".fragment"), false);
  assertStringIncludes(md, "~2'. Story.");
  assertStringIncludes(md, "doi:10.1016/x");
});

Deno.test("section and statement slides", () => {
  assertStringIncludes(sectionSlide("SCENITH", "by flow"), "# SCENITH {.section .center");
  assertStringIncludes(statementSlide("Big", 0.2), "## {.statement .center}");
});

Deno.test("insertSlide appends or goes after a named slide", () => {
  const src = "## A\n\ntext\n\n## B\n\nmore\n";
  assertEquals(insertSlide(src, "## N\n").endsWith("## N\n"), true);
  const mid = insertSlide(src, "## N\n", "A");
  assertEquals(mid.indexOf("## N") < mid.indexOf("## B"), true);
  assertEquals(mid.indexOf("## A") < mid.indexOf("## N"), true);
  assertThrows(() => insertSlide(src, "## N\n", "Z"));
});
