import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  boxToPixels,
  checkNumber,
  citationFromMeta,
  referenceFromMeta,
  crc32,
  doiStem,
  drawRect,
  drawGrid,
  encodePng,
  exifOrientation,
  extractNumbers,
  findPaper,
  findWords,
  imageFilter,
  imageSize,
  isDoi,
  keyFromMeta,
  normalizePaperText,
  type PageLayout,
  parseBboxLayout,
  resolveAnchor,
  sentenceAt,
  slideNumbers,
  slideParts,
  snippet,
} from "./figures.ts";
import { pixelCrop, pngSize } from "./sources.ts";

const w = (
  text: string,
  x: number,
  y: number,
  _line: number,
  _block: number,
  wd = 5,
) =>
  `<word xMin="${x}" yMin="${y}" xMax="${x + wd}" yMax="${
    y + 7
  }">${text}</word>`;

/** A page like Hirschey 2010 p2: panels c and d side by side, caption below. */
const XHTML = `<doc><page width="595.2" height="782.3">
<flow><block xMin="34.8" yMin="686" xMax="287" yMax="700"><line>${
  w("Figure", 34.8, 686.5, 0, 0, 21)
}${w("2", 57, 686.5, 0, 0)}</line></block></flow>
<flow><block xMin="355" yMin="515" xMax="386" yMax="522"><line>${
  w("Substrate", 355.6, 515.2, 9, 9, 30)
}</line></block></flow>
<flow><block xMin="303" yMin="521" xMax="309" yMax="529"><line>${
  w("c", 303.6, 521.6, 1, 1)
}</line></block></flow>
<flow><block xMin="463" yMin="521" xMax="469" yMax="529"><line>${
  w("d", 463.3, 521.6, 2, 2)
}</line></block></flow>
<flow><block xMin="332" yMin="634" xMax="408" yMax="641"><line>${
  w("Heart", 332.3, 634.6, 3, 3, 17)
}${w("BAT", 395.2, 634.6, 3, 3, 12)}</line></block></flow>
<flow><block xMin="300.8" yMin="648.7" xMax="560.1" yMax="700"><line>${
  w("Figure", 300.9, 648.8, 4, 4, 21)
}${w("3", 324, 648.8, 4, 4)}${w("|", 330, 648.8, 4, 4, 1)}</line>
<line>${w("a,", 300.9, 660, 5, 4, 6)}${w("c,", 463.4, 677.2, 5, 4, 6)}${
  w("R&amp;D", 480, 677.2, 5, 4, 10)
}</line></block></flow>
</page></doc>`;

Deno.test("parseBboxLayout reads pages, words, lines and blocks", () => {
  const [p] = parseBboxLayout(XHTML);
  assertEquals(p.width, 595.2);
  assertEquals(p.words.length, 13);
  assertEquals(p.words[1].text, "2");
  assertEquals(p.words[0].line, p.words[1].line);
  assertEquals(p.words.find((x) => x.text === "R&D")?.block, 5);
});

Deno.test("findWords matches words, phrases on one line and regexes", () => {
  const [p] = parseBboxLayout(XHTML);
  assertEquals(findWords(p, "Figure").length, 2);
  const ph = findWords(p, "Figure 3");
  assertEquals(ph.length, 1);
  assertEquals(ph[0].xMin, 300.9);
  assertEquals(ph[0].xMax, 329);
  assertEquals(findWords(p, "/^[cd]$/").map((m) => m.text), ["c", "d"]);
  assertEquals(findWords(p, "Figure 3,").length, 1); // trailing punctuation ignored
});

Deno.test("resolveAnchor: panel label to caption, right edge at the next panel", () => {
  const [p] = parseBboxLayout(XHTML);
  const r = resolveAnchor(p, {
    from: "c",
    to: "Figure",
    near: { x: 303, y: 521 },
  });
  assertEquals(r.from.xMin, 303.6);
  assertEquals(r.to?.xMin, 300.9); // the right-column caption, not Figure 2 on the left
  const b = r.box;
  assertEquals([b.x, b.y].map((v) => +v.toFixed(1)), [299.6, 521.6]); // not above "c": "Substrate" ends at 522.2
  assertEquals(+(b.x + b.w).toFixed(1), 459.3); // "d" at 463.3 minus pad
  assertEquals(+(b.y + b.h).toFixed(1), 644.8); // caption at 648.8 minus pad
  assertEquals(r.edges.top.includes("Substrate"), true);
  assertEquals(r.edges.right.startsWith("next panel label"), true);
});

/** Like Hirschey 2010 p4: panel b above c, b's axis title level with label c. */
const XHTML_STACK = `<doc><page width="595.2" height="782.3">
<flow><block xMin="338" yMin="187" xMax="344" yMax="195"><line>${
  w("b", 338.3, 187.0, 0, 0)
}</line></block></flow>
<flow><block xMin="364" yMin="307" xMax="491" yMax="315"><line>${
  w("0", 364.3, 307.6, 1, 1, 4)
}${w("6", 486.6, 307.6, 1, 1, 4)}</line></block></flow>
<flow><block xMin="428" yMin="316" xMax="453" yMax="323"><line>${
  w("Time", 428.1, 316.1, 2, 2, 15)
}${w("(h)", 445.3, 316.1, 2, 2, 7)}</line></block></flow>
<flow><block xMin="338" yMin="322" xMax="344" yMax="331"><line>${
  w("c", 338.5, 322.9, 3, 3)
}</line></block></flow>
<flow><block xMin="350" yMin="324" xMax="363" yMax="332"><line>${
  w("300", 350.6, 324.7, 4, 4, 12)
}</line></block></flow>
</page></doc>`;

Deno.test("resolveAnchor: bottom at the next panel label keeps an axis title level with it", () => {
  const [p] = parseBboxLayout(XHTML_STACK);
  const r = resolveAnchor(p, { from: "b", w: 220 });
  const bottom = r.box.y + r.box.h;
  // "Time (h)" ends at 323.1; label "c" starts at 322.9 (pad 4 would cut at 318.9)
  assertEquals(+bottom.toFixed(1), 323.4);
  assertEquals(r.edges.bottom.includes("Time"), true);
  // the y tick "300" of panel c (starts below c's top) is not pulled in
  assertEquals(bottom < 324.7, true);
});

Deno.test("resolveAnchor: explicit right word and width; ambiguous from throws", () => {
  const [p] = parseBboxLayout(XHTML);
  const r = resolveAnchor(p, {
    from: "c",
    to: "Figure 3",
    right: "BAT",
    near: { x: 300, y: 520 },
    pad: 0,
  });
  assertEquals(r.box.x + r.box.w, 407.2);
  const r2 = resolveAnchor(p, { from: "d", w: 50, h: 20, pad: 0 });
  assertEquals([r2.box.w, r2.box.h].map((v) => Math.round(v)), [50, 20]);
  assertThrows(
    () => resolveAnchor(p, { from: "Figure" }),
    Error,
    "occurs 2 times",
  );
  assertThrows(
    () => resolveAnchor(p, { from: "zebra" }),
    Error,
    "not on the page",
  );
});

Deno.test("pixelCrop keeps dpi/72 px per point (edges rounded, not sizes)", () => {
  const a = pixelCrop({ x: 10.3, y: 0, w: 100.4, h: 10 }, 200);
  const b = pixelCrop({ x: 110.7, y: 0, w: 50, h: 10 }, 200);
  assertEquals(a.x + a.W, b.x); // abutting boxes abut in pixels
  assertEquals(pixelCrop({ x: 72, y: 36, w: 144, h: 72 }, 200), {
    x: 200,
    y: 100,
    W: 400,
    H: 200,
  });
});

Deno.test("encodePng writes a valid PNG with a drawn rectangle", async () => {
  assertEquals(crc32(new TextEncoder().encode("IEND")), 0xae426082);
  const img = {
    width: 20,
    height: 10,
    data: new Uint8Array(20 * 10 * 3).fill(255),
  };
  drawRect(img, { x: 2, y: 2, W: 10, H: 5 }, [255, 0, 0], 1);
  assertEquals([...img.data.subarray((2 * 20 + 2) * 3, (2 * 20 + 2) * 3 + 3)], [
    255,
    0,
    0,
  ]);
  assertEquals([...img.data.subarray((4 * 20 + 5) * 3, (4 * 20 + 5) * 3 + 3)], [
    255,
    255,
    255,
  ]);
  const png = await encodePng(img);
  assertEquals(pngSize(png), { width: 20, height: 10 });
  assertEquals(imageSize(png)?.format, "png");
});

/** SOI + APP1 Exif with one IFD0 entry (Orientation) + EOI. */
function exifJpeg(orientation: number, le: boolean): Uint8Array {
  const u16 = (v: number) => le ? [v & 255, v >> 8] : [v >> 8, v & 255];
  const u32 = (v: number) =>
    le ? [v & 255, (v >> 8) & 255, 0, 0] : [0, 0, (v >> 8) & 255, v & 255];
  const tiff = [
    ...(le ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...u16(1), // one entry
    ...u16(0x0112),
    ...u16(3), // SHORT
    ...u32(1),
    ...u16(orientation),
    0,
    0,
    ...u32(0), // no next IFD
  ];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = body.length + 2;
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    len >> 8,
    len & 255,
    ...body,
    0xff,
    0xd9,
  ]);
}

Deno.test("exifOrientation reads both byte orders; imageFilter turns upright before the crop", () => {
  assertEquals(exifOrientation(exifJpeg(6, true)), 6);
  assertEquals(exifOrientation(exifJpeg(8, false)), 8);
  assertEquals(exifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), 1);
  assertEquals(exifOrientation(new Uint8Array([0x89, 0x50])), 1);
  assertEquals(
    imageFilter("jpeg", 6, { x: 1, y: 2, w: 30, h: 40 }),
    "format=rgb24,transpose=1,crop=30:40:1:2",
  );
  assertEquals(imageFilter("png", 1, null), "format=rgba");
});

Deno.test("imageSize reads JPEG SOF; boxToPixels takes pixels or fractions", () => {
  // SOI, APP0 (len 4), SOF0 with height 300 width 400
  const jpg = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0,
    4,
    0,
    0,
    0xff,
    0xc0,
    0,
    17,
    8,
    1,
    44,
    1,
    144,
    3,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
  assertEquals(imageSize(jpg), { width: 400, height: 300, format: "jpeg" });
  const img = { width: 400, height: 300 };
  assertEquals(boxToPixels({ x: 0, y: 0, w: 0.5, h: 0.5 }, img), {
    x: 0,
    y: 0,
    w: 200,
    h: 150,
  });
  assertEquals(boxToPixels({ x: 350, y: 10, w: 100, h: 20 }, img), {
    x: 350,
    y: 10,
    w: 50,
    h: 20,
  });
});

Deno.test("house-style source lines and references, lecturer in bold", () => {
  const okafor = {
    authors: [
      "Lena Okafor",
      "Peter\u00a0J. Lindqvist",
      "Maria\u00a0K. Santos",
      "Anna\u00a0M. van\u00a0Dam",
      "Tom Reyes",
      "Hannah\u00a0R. Brandt",
    ],
    year: 2017,
    journal: "Molecular Cell",
    volume: "68",
    page: "412-425",
    title: "Hexokinase 2 Binding to Mitochondria Sets the Pace of Glycolysis in Activated T Cells",
  };
  assertEquals(
    citationFromMeta(okafor, "van Dam"),
    "Okafor, Lindqvist, Santos, **van Dam** et al. 2017, Mol Cell 68:412",
  );
  assertEquals(citationFromMeta(okafor), "Okafor et al. 2017, Mol Cell 68:412");
  assertEquals(
    referenceFromMeta(okafor, "van Dam"),
    "Okafor L, Lindqvist PJ, Santos MK, **van Dam AM**, Reyes T, Brandt HR (2017) Hexokinase 2 Binding to Mitochondria Sets the Pace of Glycolysis in Activated T Cells. Mol Cell 68:412–425",
  );
  const becker = {
    authors: [
      "Jonas Becker",
      "Sofia Marino",
      ...Array.from({ length: 15 }, (_, i) => `A. Author${i}`),
      "Richard Holt",
      "Anna M. van Dam",
      "David B. Okoro",
    ],
    year: 2021,
    journal: "iScience",
    volume: "24",
    page: "102345",
  };
  assertEquals(
    citationFromMeta(becker, "van Dam"),
    "Becker, Marino ... **van Dam** & Okoro 2021, iScience 24:102345",
  );
  assertStringIncludes(
    referenceFromMeta(becker, "van Dam")!,
    "Becker J, Marino S, Author0 A … **van Dam AM** … Okoro DB (2021)",
  );
  // five authors: all listed
  assertEquals(
    citationFromMeta(
      {
        authors: ["L Okafor", "J Becker", "A Guo", "D Okoro", "A van Dam"],
        year: 2020,
        journal: "Scientific Reports",
        volume: "10",
        page: "17030",
      },
      "van Dam",
    ),
    "Okafor, Becker, Guo, Okoro & **van Dam** 2020, Sci Rep 10:17030",
  );
});

Deno.test("paper keys and citations from metadata; DOI file stems", () => {
  const m = {
    authors: ["Matthew D. Hirschey", "Tadahiro Shimazu", "Eric Verdin"],
    year: 2010,
    journal: "Nature",
  };
  assertEquals(keyFromMeta(m), "hirschey2010");
  assertEquals(citationFromMeta(m), "Hirschey et al. 2010, Nature");
  assertEquals(
    citationFromMeta({ authors: ["A. Sbarra", "M. L. Karnovsky"], year: 1959 }),
    "Sbarra & Karnovsky 1959",
  );
  assertEquals(
    keyFromMeta({ authors: ["Robert V. Farese Jr"], year: 2001 }),
    "farese2001",
  );
  assertEquals(
    keyFromMeta({ authors: ["José Müller"], year: 1999 }),
    "muller1999",
  );
  assertEquals(
    doiStem("https://doi.org/10.1038/nature08778"),
    "10.1038_nature08778",
  );
  assertEquals(isDoi("10.1038/nature08778"), true);
  assertEquals(isDoi("hirschey2010"), false);
});

Deno.test("findPaper resolves by doi, file stem and author-year key", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qd-papers-" });
  await Deno.writeTextFile(`${dir}/10.1234_x.pdf`, "%PDF");
  await Deno.writeTextFile(
    `${dir}/10.1234_x.json`,
    JSON.stringify({
      doi: "10.1234/x",
      authors: ["Ann Bee"],
      year: 2001,
      journal: "Cell",
    }),
  );
  assertEquals((await findPaper(dir, { doi: "10.1234/x" }))?.key, "bee2001");
  assertEquals(
    (await findPaper(dir, { key: "10.1234/x" }))?.citation,
    "Bee 2001, Cell",
  );
  assertEquals((await findPaper(dir, { key: "10.1234_x" }))?.doi, "10.1234/x");
  assertEquals(
    (await findPaper(dir, { key: "bee2001" }))?.pdf,
    `${dir}/10.1234_x.pdf`,
  );
  assertEquals(await findPaper(dir, { key: "nobody1900" }), null);
  await Deno.remove(dir, { recursive: true });
});

const SLIDE = `## Ldha knockout mice: lactate output

::: {.column width="42%"}
![](a.png){style="max-height: 500px"}
:::
<svg><text x="10">a 20% drop</text></svg>

[Moreau et al. 2019, Fig. 3c. [14C]glucose; 6 h at 4 °C]{.src}

::: notes
~2'. Heart is 33 per cent lower, muscle 51 per cent, Pkm2 mice at 28 degrees.
Ref: Moreau AB et al. Cell Metab 29:101 (2019), doi:10.1234/cmet.2019.0101.
CHECK: 99% sure.
:::

## Next slide 12 %
`;

Deno.test("slideParts splits shown, src and notes and drops Ref/CHECK", () => {
  const p = slideParts(SLIDE, 1);
  assertEquals(p.src.length, 1);
  assertEquals(p.notes.length, 1);
  assertEquals(p.shown.some((l) => l.includes("Next slide")), false);
});

Deno.test("extractNumbers keeps numbers with units, skips figure refs and glued numbers", () => {
  const ns = slideNumbers(slideParts(SLIDE, 1));
  assertEquals(ns.map((n) => `${n.value}${n.unit}@${n.where}`), [
    "20%@shown",
    "6h@src",
    "4°C@src",
    "33%@notes",
    "51%@notes",
    "28°C@notes",
  ]);
  assertEquals(
    extractNumbers("Fig. 3 h and Table 2 mM, n = 5 mice", "notes"),
    [],
  );
  assertEquals(
    extractNumbers("a 2.5-fold rise in 10 µM", "shown").map((n) => n.text),
    ["2.5-fold", "10 µM"],
  );
});

Deno.test("checkNumber: found with unit, number-only, not-found; % equals per cent", () => {
  const paper = normalizePaperText(
    "Lactate output was lower in heart (33% lower in Pkm2 mice). Mice were exposed\nto cold (4 uC) for 6 h. Fig. 51 shows nothing. See ref. 28.",
  );
  const n = (value: string, unit: string) => ({
    text: value,
    value,
    unit,
    where: "notes" as const,
  });
  const a = checkNumber(paper, n("33", "%"));
  assertEquals(a.status, "found");
  assertEquals(
    a.sentence,
    "Lactate output was lower in heart (33% lower in Pkm2 mice).",
  );
  assertEquals(checkNumber(paper, n("4", "°C")).status, "found");
  assertEquals(checkNumber(paper, n("6", "h")).status, "found");
  assertEquals(checkNumber(paper, n("28", "°C")).status, "number-only");
  assertEquals(checkNumber(paper, n("36", "%")).status, "not-found");
  assertEquals(checkNumber(paper, n("3", "%")).status, "not-found"); // 33 is not 3
});

Deno.test("sentenceAt does not stop at Fig. or et al.", () => {
  const t = "First one. Shown in Fig. 3 by Smith et al. that 33% fell. Next.";
  assertEquals(
    sentenceAt(t, t.indexOf("33")),
    "Shown in Fig. 3 by Smith et al. that 33% fell.",
  );
  const long = "x ".repeat(400) + "the 33% fell " + "y ".repeat(400);
  const s = sentenceAt(long, long.indexOf("33"));
  assertEquals([s.startsWith("…x"), s.endsWith("y…")], [true, true]);
  assertEquals(snippet(long, "33", 40).includes("33%"), true);
});

Deno.test("resolveAnchor panels=all runs past the next panel label to the caption", () => {
  const W = (text: string, x: number, y: number, block = 0) => ({
    text, xMin: x, yMin: y, xMax: x + 6, yMax: y + 8, line: 0, block,
  });
  const page = {
    page: 1, width: 600, height: 800,
    words: [W("a", 50, 100), W("b", 50, 300), W("Figure", 40, 500, 1), W("1", 80, 500, 1)],
    blocks: [{ xMin: 40, yMin: 100, xMax: 60, yMax: 310 }, { xMin: 40, yMin: 500, xMax: 300, yMax: 520 }],
  } as unknown as PageLayout;
  const one = resolveAnchor(page, { from: "a", to: "Figure" });
  const all = resolveAnchor(page, { from: "a", to: "Figure", panels: "all" });
  assertEquals(Math.round(one.box.y + one.box.h), 296); // stops at panel b
  assertEquals(Math.round(all.box.y + all.box.h), 496); // runs to the caption
});

Deno.test("resolveAnchor only accepts a to-word below from", () => {
  const p: PageLayout = parseBboxLayout(XHTML)[0];
  assertThrows(
    () => resolveAnchor(p, { from: "Heart", to: "d" }),
    Error,
    "not found below",
  );
});

Deno.test("figure_crop needs exactly one of box and anchor; verify_numbers one of slide and file", async () => {
  const { model } = await import("./quarto_deck.ts");
  // deno-lint-ignore no-explicit-any
  const m = model.methods as any;
  const ctx = {
    globalArgs: {
      dir: "/nonexistent",
      main: "t.qmd",
      sourcesDir: "sources",
      assetsDir: "assets",
    },
    logger: { info: () => {} },
  };
  await assertRejects(
    () =>
      m.figure_crop.execute({
        key: "k",
        page: 1,
        label: "l",
        section: "s",
        dpi: 200,
        trim: false,
        pad: 4,
      }, ctx),
    Error,
    "give box or anchor",
  );
  await assertRejects(
    () => m.verify_numbers.execute({}, ctx),
    Error,
    "give slide",
  );
});

Deno.test("drawGrid marks every 50 pt and labels every 100 pt", () => {
  const img = { width: 300, height: 300, data: new Uint8Array(300 * 300 * 3).fill(255) };
  drawGrid(img, 144); // 2 px per pt: lines at 100, 200 px
  const at = (x: number, y: number) => img.data[(y * 300 + x) * 3];
  assertEquals(at(100, 150) < 255, true); // 50 pt line
  assertEquals(at(200, 150) < at(100, 150), true); // 100 pt line is darker
  assertEquals(at(150, 150), 255); // between lines
});
