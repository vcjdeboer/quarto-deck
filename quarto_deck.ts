/**
 * @vcjdeboer/quarto-deck/deck — one Quarto reveal.js deck project.
 *
 * Outline the source (slides, hidden, notes, timing budget, CHECK markers,
 * missing images, DOIs), render it with Quarto (R/knitr executes — the deck is
 * the author's own and trusted), check the built deck in headless Chrome
 * (overflow per slide, contact sheets) and export a distribution PDF. Every
 * result is versioned swamp data.
 * @module
 */
import { z } from "npm:zod@4";
import { type DeckOutline, outlineDeck } from "./outline.ts";
import { checkDeck, contactSheets } from "./check.ts";
import { MAC_CHROME } from "./chrome.ts";
import { pdfPages, printDeck, shrinkPdf } from "./pdf.ts";
import {
  type BuildRecord,
  hashInputs,
  renderDeck,
  renderInputs,
  toolVersions,
} from "./render.ts";
import {
  boxToPoints,
  type FigureRecord,
  findCaptions,
  inkBounds,
  pageTexts,
  parsePpm,
  pdfGeometry,
  pixelCrop,
  pngSize,
  renderPage,
  renderPpm,
  searchPages,
  sha256File,
  slug,
  type SourceRecord,
  trimmedBox,
} from "./sources.ts";
import { captureSlides } from "./check.ts";
import { imagePptx } from "./export_pptx.ts";
import {
  insertSlide,
  paperSlide,
  sectionSlide,
  statementSlide,
} from "./slides.ts";
import {
  inventory,
  keynoteExport,
  knockOutWhite,
  layerCopy,
  loadPptx,
  mediaName,
  openPptx,
  qmdStub,
  slideShapes,
  withPptx,
} from "./pptx.ts";

const GlobalArgsSchema = z.object({
  dir: z.string().describe("Absolute path of the deck project folder"),
  main: z.string().describe("Main .qmd file, relative to dir"),
  slotMinutes: z.number().positive().optional().describe(
    "Talk slot in minutes, compared with the timing in the speaker notes",
  ),
  chrome: z.string().default(MAC_CHROME).describe("Chrome/Chromium binary"),
  quarto: z.string().default("quarto").describe("Quarto binary"),
  sourcesDir: z.string().default("sources").describe(
    "Where source PDFs are kept, relative to dir",
  ),
  assetsDir: z.string().default("assets").describe(
    "Where slide images go, relative to dir",
  ),
});
type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

const SlideSchema = z.object({
  n: z.number(),
  level: z.number(),
  title: z.string(),
  classes: z.array(z.string()),
  hidden: z.boolean(),
  file: z.string(),
  line: z.number(),
  fragments: z.number(),
  steps: z.number(),
  hasRef: z.boolean(),
  hasNotes: z.boolean(),
  minutes: z.number().nullable(),
  images: z.array(z.string()),
  src: z.array(z.string()),
  dois: z.array(z.string()),
  checks: z.array(z.string()),
});

const OutlineSchema = z.object({
  main: z.string(),
  title: z.string().nullable(),
  files: z.array(z.string()),
  slides: z.array(SlideSchema),
  visibleSlides: z.number(),
  hiddenSlides: z.number(),
  notesCoverage: z.number(),
  timedSlides: z.number(),
  untimedVisible: z.array(z.number()),
  minutesPlanned: z.number(),
  slotMinutes: z.number().nullable(),
  missingImages: z.array(z.object({ slide: z.number(), path: z.string() })),
  checks: z.array(
    z.object({
      slide: z.number().nullable(),
      file: z.string(),
      text: z.string(),
    }),
  ),
  dois: z.array(z.string()),
  missingIncludes: z.array(z.string()),
  styleIssues: z.array(z.object({
    slide: z.number(),
    title: z.string(),
    rule: z.enum([
      "one-figure",
      "one-source",
      "no-builds",
      "notes",
      "timing",
      "doi",
    ]),
    level: z.enum(["rule", "hint"]),
    message: z.string(),
  })),
});

const BuildSchema = z.object({
  main: z.string(),
  html: z.string(),
  inputHash: z.string(),
  inputs: z.number(),
  seconds: z.number(),
  quartoVersion: z.string().nullable(),
  rVersion: z.string().nullable(),
  warnings: z.array(z.string()),
  renderedAt: z.string(),
});

const SlideCheckSchema = z.object({
  n: z.number(),
  h: z.number(),
  v: z.number(),
  title: z.string(),
  fragments: z.number(),
  overflowPx: z.number(),
  overflowElement: z.string(),
});

const CheckSchema = z.object({
  html: z.string(),
  slideCount: z.number(),
  overflowing: z.array(SlideCheckSchema),
  slides: z.array(SlideCheckSchema),
  width: z.number(),
  height: z.number(),
  sheets: z.number(),
  checkedAt: z.string(),
});

const PdfInfoSchema = z.object({
  path: z.string(),
  pages: z.number().nullable(),
  bytes: z.number(),
  rawBytes: z.number(),
  shrunk: z.boolean(),
  exportedAt: z.string(),
});

const SourceSchema = z.object({
  key: z.string(),
  citation: z.string(),
  doi: z.string().nullable(),
  original: z.string(),
  stored: z.string(),
  sha256: z.string(),
  pages: z.number(),
  pageSizes: z.array(
    z.object({ page: z.number(), width: z.number(), height: z.number() }),
  ),
  captions: z.array(
    z.object({ page: z.number(), label: z.string(), text: z.string() }),
  ),
  addedAt: z.string(),
});

const HitsSchema = z.object({
  key: z.string(),
  query: z.string(),
  hits: z.array(z.object({ page: z.number(), line: z.string() })),
  truncated: z.boolean(),
});

const BoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const FigureSchema = z.object({
  key: z.string(),
  label: z.string(),
  citation: z.string(),
  doi: z.string().nullable(),
  sourceSha256: z.string(),
  page: z.number(),
  boxPt: BoxSchema,
  requestedBoxPt: BoxSchema,
  trimmed: z.boolean(),
  dpi: z.number(),
  path: z.string(),
  widthPx: z.number(),
  heightPx: z.number(),
  sha256: z.string(),
  createdAt: z.string(),
});

const JournalEntrySchema = z.object({
  at: z.string(),
  kind: z.enum([
    "decision",
    "change",
    "request",
    "source",
    "figure",
    "slide",
    "port",
    "note",
  ]),
  text: z.string(),
  slide: z.string().optional(),
  ref: z.string().optional(),
});
type JournalEntry = z.infer<typeof JournalEntrySchema>;

const JournalSchema = z.object({ entries: z.array(JournalEntrySchema) });

const PptxSlideSchema = z.object({
  n: z.number(),
  part: z.string(),
  title: z.string(),
  text: z.array(z.string()),
  notes: z.string(),
  hidden: z.boolean(),
  media: z.array(z.string()),
});

const PptxInventorySchema = z.object({
  deck: z.string(),
  path: z.string(),
  slides: z.array(PptxSlideSchema),
});

const PptxExtractSchema = z.object({
  deck: z.string(),
  path: z.string(),
  slides: z.array(z.number()),
  files: z.array(
    z.object({ slide: z.number(), from: z.string(), path: z.string() }),
  ),
});

const LayerSchema = z.object({
  deck: z.string(),
  slide: z.number(),
  name: z.string(),
  keep: z.array(z.string()).optional(),
  drop: z.array(z.string()).optional(),
  path: z.string(),
  transparent: z.boolean(),
});

const PptxInfoSchema = z.object({
  path: z.string(),
  slides: z.number(),
  withNotes: z.number(),
  bytes: z.number(),
  exportedAt: z.string(),
});

const SlideRecordSchema = z.object({
  kind: z.enum(["paper", "section", "statement"]),
  file: z.string(),
  title: z.string(),
  figure: z.string().optional(),
  markdown: z.string(),
  addedAt: z.string(),
});

type Handle = { name: string };
interface FileWriter {
  writeAll(content: Uint8Array): Promise<Handle>;
  writeText(text: string): Promise<Handle>;
}
interface DeckContext {
  globalArgs: GlobalArgs;
  logger: { info: (msg: string, props?: Record<string, unknown>) => void };
  writeResource: (
    spec: string,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<Handle>;
  readResource?: (
    name: string,
    version?: number,
  ) => Promise<Record<string, unknown> | null>;
  createFileWriter: (spec: string, name: string) => FileWriter;
}

/** Append entries to the build journal (each append is a new version). */
async function journal(
  ctx: DeckContext,
  ...entries: Array<Omit<JournalEntry, "at">>
): Promise<Handle> {
  const cur = await ctx.readResource?.("journal").catch(() => null) as
    | { entries: JournalEntry[] }
    | null;
  const at = new Date().toISOString();
  return await ctx.writeResource("journal", "journal", {
    entries: [...(cur?.entries ?? []), ...entries.map((e) => ({ at, ...e }))],
  });
}

/** Short deck key from a file path. */
function deckKey(path: string): string {
  return slug((path.split("/").pop() ?? "deck").replace(/\.[^.]+$/, ""));
}

/** Latest record of a registered source, or a clear error. */
async function requireSource(
  ctx: DeckContext,
  key: string,
): Promise<SourceRecord> {
  const rec = await ctx.readResource?.(`source-${slug(key)}`) as
    | SourceRecord
    | null;
  if (!rec) {
    throw new Error(`source "${key}" not registered — run source_add first`);
  }
  return rec;
}

/** True when `source` already contains exactly this line (ignoring edge spaces). */
export function hasLine(source: string, line: string): boolean {
  return source.split("\n").some((l) => l.trim() === line.trim());
}

/** Path of the HTML Quarto writes for `main`. */
export function htmlPath(dir: string, main: string): string {
  return `${dir.replace(/\/$/, "")}/${
    main.replace(/\.(qmd|md|ipynb|Rmd)$/, "")
  }.html`;
}

/** One-line human summary of an outline. */
export function outlineSummary(o: DeckOutline): string {
  const slot = o.slotMinutes ? ` / ${o.slotMinutes} min slot` : "";
  return `${o.visibleSlides} visible slides (+${o.hiddenSlides} hidden), ` +
    `${o.minutesPlanned} min planned${slot}, notes on ${
      Math.round(o.notesCoverage * 100)
    }%, ` +
    `${o.checks.length} CHECK, ${o.missingImages.length} missing images, ` +
    `${o.styleIssues.filter((x) => x.level === "rule").length} style issues ` +
    `(+${o.styleIssues.filter((x) => x.level === "hint").length} hints)`;
}

/** Model definition. */
export const model = {
  type: "@vcjdeboer/quarto-deck/deck",
  version: "2026.10.23.1",
  upgrades: [
    {
      toVersion: "2026.10.23.1",
      description:
        "House-style lint in outline, figure_crop trim, .key input; global arguments unchanged",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
  ],
  globalArguments: GlobalArgsSchema,
  reports: ["@vcjdeboer/quarto-deck/deck-summary"],
  resources: {
    outline: {
      description: "Static outline of the deck source",
      schema: OutlineSchema,
      lifetime: "infinite" as const,
      garbageCollection: 20,
    },
    build: {
      description: "Record of a Quarto render: input hash, versions, warnings",
      schema: BuildSchema,
      lifetime: "infinite" as const,
      garbageCollection: 20,
    },
    check: {
      description: "Browser check of the built deck: slides, overflow",
      schema: CheckSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    source: {
      description:
        "A registered source PDF: citation, DOI, checksum, caption index",
      schema: SourceSchema,
      lifetime: "infinite" as const,
      garbageCollection: 5,
    },
    hits: {
      description: "Text search hits in a source",
      schema: HitsSchema,
      lifetime: "7d",
      garbageCollection: 3,
    },
    figure: {
      description:
        "A figure/table cropped from a source into the deck assets, with provenance",
      schema: FigureSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    journal: {
      description:
        "How the deck was built: decisions, requests, changes, sources, figures, ported slides",
      schema: JournalSchema,
      lifetime: "infinite" as const,
      garbageCollection: 500,
    },
    slide: {
      description: "A slide written from a house pattern",
      schema: SlideRecordSchema,
      lifetime: "infinite" as const,
      garbageCollection: 5,
    },
    pptxInventory: {
      description:
        "Slides of an old PowerPoint deck: titles, text, notes, media",
      schema: PptxInventorySchema,
      lifetime: "infinite" as const,
      garbageCollection: 3,
    },
    pptxExtract: {
      description:
        "Media and slide images pulled out of a PowerPoint deck into assets",
      schema: PptxExtractSchema,
      lifetime: "infinite" as const,
      garbageCollection: 5,
    },
    layer: {
      description: "A shape layer of a PowerPoint slide exported as PNG",
      schema: LayerSchema,
      lifetime: "infinite" as const,
      garbageCollection: 5,
    },
    pptxInfo: {
      description: "Exported PowerPoint version of the deck",
      schema: PptxInfoSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    pdfInfo: {
      description: "Exported PDF: path, pages, size",
      schema: PdfInfoSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
  },
  files: {
    pagePreview: {
      description: "Rendered page of a source PDF, for choosing a crop box",
      contentType: "image/png",
      lifetime: "7d",
      garbageCollection: 3,
    },
    renderLog: {
      description: "Quarto render log",
      contentType: "text/plain",
      lifetime: "infinite" as const,
      garbageCollection: 5,
    },
    sheet: {
      description: "Contact sheet of the built deck (PNG)",
      contentType: "image/png",
      lifetime: "infinite" as const,
      garbageCollection: 5,
    },
    pptx: {
      description:
        "PowerPoint version of the deck (one image per slide + notes)",
      contentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      lifetime: "infinite" as const,
      garbageCollection: 3,
    },
    pdf: {
      description: "Distribution PDF of the deck",
      contentType: "application/pdf",
      lifetime: "infinite" as const,
      garbageCollection: 3,
    },
  },
  methods: {
    outline: {
      description:
        "Parse the deck source (following includes) without rendering: slides, hidden, notes coverage, timing vs slot, CHECK markers, missing images, DOIs",
      arguments: z.object({}),
      execute: async (
        _args: Record<string, never>,
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        const o = outlineDeck(g.dir, g.main, g.slotMinutes ?? null);
        ctx.logger.info(outlineSummary(o));
        for (const x of o.styleIssues.filter((i) => i.level === "rule")) {
          ctx.logger.info('style: slide {slide} "{title}": {message}', {
            ...x,
          });
        }
        const h = await ctx.writeResource("outline", "outline", { ...o });
        return { dataHandles: [h] };
      },
    },
    render: {
      description:
        "quarto render the deck (R/knitr executes). Skipped when no input changed since the last build unless force=true",
      arguments: z.object({
        force: z.boolean().default(false).describe(
          "Render even when inputs are unchanged",
        ),
      }),
      execute: async (
        args: { force: boolean },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        const o = outlineDeck(g.dir, g.main, g.slotMinutes ?? null);
        const inputs = renderInputs(g.dir, o);
        const inputHash = await hashInputs(g.dir, inputs);
        const html = htmlPath(g.dir, g.main);
        const last = await ctx.readResource?.("build").catch(() => null) as
          | BuildRecord
          | null;
        const htmlExists = await Deno.stat(html).then(() => true, () => false);
        if (!args.force && last && last.inputHash === inputHash && htmlExists) {
          ctx.logger.info("Inputs unchanged since {at}; render skipped", {
            at: last.renderedAt,
          });
          return { dataHandles: [] };
        }
        const r = await renderDeck({
          dir: g.dir,
          main: g.main,
          quarto: g.quarto,
        });
        const versions = await toolVersions(g.quarto);
        const record: BuildRecord = {
          main: g.main,
          html,
          inputHash,
          inputs: inputs.length,
          seconds: r.seconds,
          ...versions,
          warnings: r.warnings,
          renderedAt: new Date().toISOString(),
        };
        ctx.logger.info("Rendered {html} in {s}s, {w} warnings", {
          html,
          s: r.seconds,
          w: r.warnings.length,
        });
        const h1 = await ctx.writeResource("build", "build", { ...record });
        const h2 = await ctx.createFileWriter("renderLog", "render-log")
          .writeText(r.log);
        return { dataHandles: [h1, h2] };
      },
    },
    check: {
      description:
        "Open the built deck in headless Chrome: every slide with all fragments shown, overflow beyond the slide box, contact sheets",
      arguments: z.object({
        sheets: z.boolean().default(true).describe("Make contact sheets"),
        width: z.number().default(1280),
        height: z.number().default(720),
      }),
      execute: async (
        args: { sheets: boolean; width: number; height: number },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        const html = htmlPath(g.dir, g.main);
        await Deno.stat(html).catch(() => {
          throw new Error(`${html} not found — run render first`);
        });
        const { check, shots } = await checkDeck({
          html,
          chrome: g.chrome,
          width: args.width,
          height: args.height,
          screenshots: args.sheets,
        });
        const handles: Handle[] = [];
        let nSheets = 0;
        if (args.sheets) {
          const sheets = await contactSheets(
            shots,
            check.slides.map((s) => s.title),
            {
              chrome: g.chrome,
            },
          );
          for (const [i, png] of sheets.entries()) {
            handles.push(
              await ctx.createFileWriter("sheet", `sheet-${i + 1}`).writeAll(
                png,
              ),
            );
          }
          nSheets = sheets.length;
        }
        for (const s of check.overflowing) {
          ctx.logger.info('slide {n} "{t}" overflows by {px}px <- {el}', {
            n: s.n,
            t: s.title,
            px: s.overflowPx,
            el: s.overflowElement,
          });
        }
        ctx.logger.info("{n} slides, {o} overflowing, {k} sheets", {
          n: check.slideCount,
          o: check.overflowing.length,
          k: nSheets,
        });
        handles.unshift(
          await ctx.writeResource("check", "check", {
            ...check,
            sheets: nSheets,
            checkedAt: new Date().toISOString(),
          }),
        );
        return { dataHandles: handles };
      },
    },
    export_pdf: {
      description:
        "Print the built deck to PDF with headless Chrome and (macOS) shrink it with a Quartz filter for distribution",
      arguments: z.object({
        out: z.string().optional().describe(
          "Output PDF path (default: next to the deck)",
        ),
        shrink: z.boolean().default(true),
        quality: z.number().min(0.1).max(1).default(0.75),
        dpi: z.number().default(150),
        maxPx: z.number().default(1600),
        store: z.boolean().default(true).describe(
          "Also keep the PDF as swamp data",
        ),
      }),
      execute: async (
        args: {
          out?: string;
          shrink: boolean;
          quality: number;
          dpi: number;
          maxPx: number;
          store: boolean;
        },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        const html = htmlPath(g.dir, g.main);
        const out = args.out ?? html.replace(/\.html$/, ".pdf");
        const tmp = await Deno.makeTempDir({ prefix: "quarto-deck-pdf-" });
        try {
          const raw = `${tmp}/raw.pdf`;
          await printDeck({ html, out: raw, chrome: g.chrome });
          const rawBytes = (await Deno.stat(raw)).size;
          let shrunk = false;
          if (args.shrink && Deno.build.os === "darwin") {
            const small = `${tmp}/small.pdf`;
            const size = await shrinkPdf({
              input: raw,
              out: small,
              quality: args.quality,
              dpi: args.dpi,
              maxPx: args.maxPx,
            });
            if (size < rawBytes) {
              await Deno.copyFile(small, out);
              shrunk = true;
            }
          }
          if (!shrunk) await Deno.copyFile(raw, out);
          const bytes = (await Deno.stat(out)).size;
          const pages = await pdfPages(out);
          ctx.logger.info("PDF {out}: {p} pages, {mb} MB (raw {raw} MB)", {
            out,
            p: pages,
            mb: (bytes / 1e6).toFixed(1),
            raw: (rawBytes / 1e6).toFixed(1),
          });
          const handles = [
            await ctx.writeResource("pdfInfo", "pdf-info", {
              path: out,
              pages,
              bytes,
              rawBytes,
              shrunk,
              exportedAt: new Date().toISOString(),
            }),
          ];
          if (args.store) {
            handles.push(
              await ctx.createFileWriter("pdf", "deck-pdf").writeAll(
                await Deno.readFile(out),
              ),
            );
          }
          return { dataHandles: handles };
        } finally {
          await Deno.remove(tmp, { recursive: true }).catch(() => {});
        }
      },
    },
    source_add: {
      description:
        "Register a paper PDF as a deck source: copy it into sourcesDir, record citation, DOI, checksum, pages and the figure/table caption index",
      arguments: z.object({
        pdf: z.string().describe("Path of the PDF"),
        key: z.string().describe("Short key, e.g. sbarra1959"),
        citation: z.string().describe(
          "Source line as it should appear on the slide, e.g. 'Sbarra & Karnovsky, J Biol Chem 1959'",
        ),
        doi: z.string().optional(),
      }),
      execute: async (
        args: { pdf: string; key: string; citation: string; doi?: string },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        const key = slug(args.key);
        const storedRel = `${g.sourcesDir}/${key}.pdf`;
        const stored = `${g.dir}/${storedRel}`;
        await Deno.mkdir(`${g.dir}/${g.sourcesDir}`, { recursive: true });
        const src = await Deno.realPath(args.pdf);
        if (src !== await Deno.realPath(stored).catch(() => "")) {
          await Deno.copyFile(src, stored);
        }
        const { pages, sizes } = await pdfGeometry(stored);
        const texts = await pageTexts(stored);
        const rec: SourceRecord = {
          key,
          citation: args.citation,
          doi: args.doi ?? null,
          original: src,
          stored: storedRel,
          sha256: await sha256File(stored),
          pages,
          pageSizes: sizes,
          captions: findCaptions(texts),
          addedAt: new Date().toISOString(),
        };
        ctx.logger.info("{key}: {p} pages, {c} captions", {
          key,
          p: pages,
          c: rec.captions.length,
        });
        for (const c of rec.captions) {
          ctx.logger.info("  p{page} {label} {text}", { ...c });
        }
        const h = await ctx.writeResource("source", `source-${key}`, {
          ...rec,
        });
        const j = await journal(ctx, {
          kind: "source",
          text: `added ${args.citation} (${pages} pages) from ${src}`,
          ref: key,
        });
        return { dataHandles: [h, j] };
      },
    },
    source_find: {
      description:
        "Search a registered source's text (e.g. 'Table 1', a phrase); lists page and line of each hit",
      arguments: z.object({ key: z.string(), query: z.string() }),
      execute: async (
        args: { key: string; query: string },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const rec = await requireSource(ctx, args.key);
        const max = 50;
        // ask for one more than kept, so a capped result is known to be capped
        const found = searchPages(
          await pageTexts(`${ctx.globalArgs.dir}/${rec.stored}`),
          args.query,
          max + 1,
        );
        const hits = found.slice(0, max);
        for (const x of hits) ctx.logger.info("p{page}: {line}", { ...x });
        if (found.length > max) {
          ctx.logger.info("more than {max} hits; refine the query", { max });
        }
        const h = await ctx.writeResource("hits", `hits-${rec.key}`, {
          key: rec.key,
          query: args.query,
          hits,
          truncated: found.length > max,
        });
        return { dataHandles: [h] };
      },
    },
    source_page: {
      description:
        "Render one page of a source as PNG (stored as data and written to outPng if given) to pick a crop box",
      arguments: z.object({
        key: z.string(),
        page: z.number().int().positive(),
        dpi: z.number().default(72).describe(
          "72 dpi: 1 px = 1 PDF point, so pixel positions are crop points",
        ),
        outPng: z.string().optional(),
      }),
      execute: async (
        args: { key: string; page: number; dpi: number; outPng?: string },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const rec = await requireSource(ctx, args.key);
        if (args.page > rec.pages) {
          throw new Error(`${rec.key} has ${rec.pages} pages`);
        }
        const png = await renderPage({
          pdf: `${ctx.globalArgs.dir}/${rec.stored}`,
          page: args.page,
          dpi: args.dpi,
        });
        if (args.outPng) await Deno.writeFile(args.outPng, png);
        const { width, height } = pngSize(png);
        ctx.logger.info("{key} p{page}: {w}x{h}px at {dpi} dpi", {
          key: rec.key,
          page: args.page,
          w: width,
          h: height,
          dpi: args.dpi,
        });
        const h = await ctx.createFileWriter(
          "pagePreview",
          `page-${rec.key}-p${args.page}`,
        )
          .writeAll(png);
        return { dataHandles: [h] };
      },
    },
    figure_crop: {
      description:
        "Crop a figure/table from a source page into assets/<section>/<key>_<label>.png and record its provenance (page, box, dpi, checksums)",
      arguments: z.object({
        key: z.string(),
        page: z.number().int().positive(),
        box: BoxSchema.describe(
          "Crop box from the top-left: x, y, w, h in PDF points, or all four as fractions (0–1) of the page",
        ),
        label: z.string().describe("e.g. table1, fig2D"),
        section: z.string().describe("Asset sub-folder, e.g. history"),
        dpi: z.number().default(200),
        trim: z.boolean().default(false).describe(
          "Shrink the box to the ink inside it (give a generous box)",
        ),
        pad: z.number().min(0).default(4).describe(
          "Margin kept around the ink when trimming, in points",
        ),
      }),
      execute: async (
        args: {
          key: string;
          page: number;
          box: { x: number; y: number; w: number; h: number };
          label: string;
          section: string;
          dpi: number;
          trim: boolean;
          pad: number;
        },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        const rec = await requireSource(ctx, args.key);
        const size = rec.pageSizes.find((p) => p.page === args.page);
        if (!size) throw new Error(`${rec.key} has no page ${args.page}`);
        const requestedBoxPt = boxToPoints(args.box, size);
        let boxPt = requestedBoxPt;
        if (args.trim) {
          const measureDpi = 144;
          const ink = inkBounds(parsePpm(
            await renderPpm({
              pdf: `${g.dir}/${rec.stored}`,
              page: args.page,
              dpi: measureDpi,
              cropPx: pixelCrop(requestedBoxPt, measureDpi),
            }),
          ));
          if (!ink) {
            throw new Error(`the box on ${rec.key} p${args.page} is blank`);
          }
          boxPt = trimmedBox(requestedBoxPt, ink, measureDpi, args.pad);
        }
        const png = await renderPage({
          pdf: `${g.dir}/${rec.stored}`,
          page: args.page,
          dpi: args.dpi,
          cropPx: pixelCrop(boxPt, args.dpi),
        });
        const label = slug(args.label);
        const rel = `${g.assetsDir}/${
          slug(args.section)
        }/${rec.key}_${label}.png`;
        await Deno.mkdir(`${g.dir}/${g.assetsDir}/${slug(args.section)}`, {
          recursive: true,
        });
        await Deno.writeFile(`${g.dir}/${rel}`, png);
        const { width, height } = pngSize(png);
        const fig: FigureRecord = {
          key: rec.key,
          label,
          citation: rec.citation,
          doi: rec.doi,
          sourceSha256: rec.sha256,
          page: args.page,
          boxPt,
          requestedBoxPt,
          trimmed: args.trim,
          dpi: args.dpi,
          path: rel,
          widthPx: width,
          heightPx: height,
          sha256: await sha256File(`${g.dir}/${rel}`),
          createdAt: new Date().toISOString(),
        };
        ctx.logger.info("{path}: {w}x{h}px from {key} p{page}", {
          path: rel,
          w: width,
          h: height,
          key: rec.key,
          page: args.page,
        });
        const h = await ctx.writeResource(
          "figure",
          `figure-${rec.key}-${label}`,
          { ...fig },
        );
        const j = await journal(ctx, {
          kind: "figure",
          text:
            `cropped ${args.label} from ${rec.citation}, p${args.page} → ${rel}`,
          ref: `${rec.key}-${label}`,
        });
        return { dataHandles: [h, j] };
      },
    },
    journal: {
      description:
        "Record a step of building the deck: a decision, the author's request, a change, with the reason. Capture the process, not just the result",
      arguments: z.object({
        kind: JournalEntrySchema.shape.kind.default("decision"),
        text: z.string().describe(
          "What and why, e.g. 'deleted Pasteur slide: off-message for this audience'",
        ),
        slide: z.string().optional().describe("Slide title it concerns"),
        ref: z.string().optional(),
      }),
      execute: async (
        args: Omit<JournalEntry, "at">,
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        return { dataHandles: [await journal(ctx, args)] };
      },
    },
    slide_add: {
      description:
        "Write a slide from a house pattern into a section file. paper = title is the message + ONE figure (from figure_crop) + one .src + notes with timing and full ref/DOI; section; statement",
      arguments: z.object({
        kind: z.enum(["paper", "section", "statement"]),
        file: z.string().describe(
          "Section .qmd relative to dir (created if missing)",
        ),
        title: z.string().describe(
          "paper: the message; section: section title; statement: the sentence (markdown ok)",
        ),
        figure: z.string().optional().describe(
          "paper: '<key>-<label>' of a figure_crop record",
        ),
        image: z.string().optional().describe(
          "paper without a figure record: image path",
        ),
        citation: z.string().optional(),
        minutes: z.number().default(1),
        notes: z.string().default("").describe(
          "What you will say (speaker notes)",
        ),
        reference: z.string().optional().describe(
          "Full reference for the notes",
        ),
        subtitle: z.string().optional(),
        maxHeight: z.number().optional(),
        after: z.string().optional().describe(
          "Insert after the slide whose title contains this; default: append",
        ),
      }),
      execute: async (
        args: {
          kind: "paper" | "section" | "statement";
          file: string;
          title: string;
          figure?: string;
          image?: string;
          citation?: string;
          minutes: number;
          notes: string;
          reference?: string;
          subtitle?: string;
          maxHeight?: number;
          after?: string;
        },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        let md: string;
        if (args.kind === "paper") {
          let image = args.image,
            citation = args.citation,
            doi: string | null = null;
          if (args.figure) {
            const fig = await ctx.readResource?.(`figure-${args.figure}`) as
              | FigureRecord
              | null;
            if (!fig) {
              throw new Error(
                `no figure record "${args.figure}" — run figure_crop first`,
              );
            }
            image = fig.path;
            citation = citation ?? fig.citation;
            doi = fig.doi;
          }
          if (!image || !citation) {
            throw new Error("paper slide needs figure, or image + citation");
          }
          md = paperSlide({
            title: args.title,
            image,
            citation,
            minutes: args.minutes,
            notes: args.notes,
            reference: args.reference,
            doi,
            maxHeight: args.maxHeight,
          });
        } else if (args.kind === "section") {
          md = sectionSlide(args.title, args.subtitle ?? "");
        } else {
          md = statementSlide(args.title, args.minutes, args.notes);
        }
        const path = `${g.dir}/${args.file}`;
        const cur = await Deno.readTextFile(path).catch(() => "");
        // statements share one heading, so identify them by their sentence
        const key = args.kind === "statement" ? args.title : md.split("\n")[0];
        if (hasLine(cur, key)) {
          throw new Error(
            `${args.file} already has "${key}" — edit that slide instead of adding it again`,
          );
        }
        await Deno.writeTextFile(
          path,
          cur ? insertSlide(cur, md, args.after) : md,
        );
        const h = await ctx.writeResource(
          "slide",
          `slide-${slug(args.title).slice(0, 60)}`,
          {
            kind: args.kind,
            file: args.file,
            title: args.title,
            figure: args.figure,
            markdown: md,
            addedAt: new Date().toISOString(),
          },
        );
        const j = await journal(ctx, {
          kind: "slide",
          text: `added ${args.kind} slide to ${args.file}${
            args.after ? ` after "${args.after}"` : ""
          }`,
          slide: args.title,
          ref: args.figure,
        });
        return { dataHandles: [h, j] };
      },
    },
    pptx_inventory: {
      description:
        "List the slides of an old PowerPoint deck: titles, text, speaker notes, hidden, media",
      arguments: z.object({
        path: z.string().describe(".pptx, or .key (converted via Keynote)"),
      }),
      execute: async (
        args: { path: string },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const slides = await inventory(await withPptx(args.path, openPptx));
        const deck = deckKey(args.path);
        for (const s of slides) {
          ctx.logger.info("{n}{h} {title} [{m} media]", {
            n: s.n,
            h: s.hidden ? " (hidden)" : "",
            title: s.title || s.text[0] || "",
            m: s.media.length,
          });
        }
        const h = await ctx.writeResource("pptxInventory", `pptx-${deck}`, {
          deck,
          path: args.path,
          slides,
        });
        return { dataHandles: [h] };
      },
    },
    pptx_shapes: {
      description:
        "List the top-level shapes of one PowerPoint slide (ids for pptx_layer)",
      arguments: z.object({
        path: z.string(),
        slide: z.number().int().positive(),
      }),
      execute: async (
        args: { path: string; slide: number },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const shapes = await slideShapes(
          await withPptx(args.path, openPptx),
          args.slide,
        );
        for (const x of shapes) {
          ctx.logger.info("{id} {kind} {name} {text}", { ...x });
        }
        return { dataHandles: [] };
      },
    },
    pptx_extract: {
      description:
        "Pull the original images out of chosen slides of a PowerPoint deck into assets/<section>/ (full resolution); images=true also renders the slides through Keynote",
      arguments: z.object({
        path: z.string(),
        slides: z.array(z.number().int().positive()).describe("Slide numbers"),
        section: z.string(),
        images: z.boolean().default(false).describe(
          "Also render whole slides via Keynote (macOS)",
        ),
      }),
      execute: async (
        args: {
          path: string;
          slides: number[];
          section: string;
          images: boolean;
        },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        const deck = deckKey(args.path);
        // read once: a .key is converted by Keynote, which is slow
        const src = await withPptx(args.path, (p) => Deno.readFile(p));
        const zip = await loadPptx(src);
        const inv = await inventory(zip);
        const outRel = `${g.assetsDir}/${slug(args.section)}`;
        await Deno.mkdir(`${g.dir}/${outRel}`, { recursive: true });
        const files: Array<{ slide: number; from: string; path: string }> = [];
        for (const n of args.slides) {
          const s = inv[n - 1];
          if (!s) throw new Error(`${deck} has ${inv.length} slides`);
          for (const m of s.media) {
            const bytes = await zip.file(m)?.async("uint8array");
            if (!bytes) continue;
            const rel = `${outRel}/${mediaName(deck, n, m)}`;
            await Deno.writeFile(`${g.dir}/${rel}`, bytes);
            files.push({ slide: n, from: m, path: rel });
          }
        }
        if (args.images) {
          const tmp = await Deno.makeTempDir({ prefix: "quarto-deck-key-" });
          try {
            for (const n of args.slides) {
              const copy = `${tmp}/${deck}_s${n}.pptx`;
              await Deno.writeFile(copy, await layerCopy(src, n, { drop: [] }));
              const pngs = await keynoteExport(copy, `${tmp}/out_${n}`);
              if (!pngs.length) {
                throw new Error(`Keynote exported nothing for slide ${n}`);
              }
              const rel = `${outRel}/${deck}_s${
                String(n).padStart(2, "0")
              }_slide.png`;
              await Deno.copyFile(pngs[0], `${g.dir}/${rel}`);
              files.push({ slide: n, from: "keynote", path: rel });
            }
          } finally {
            await Deno.remove(tmp, { recursive: true }).catch(() => {});
          }
        }
        for (const f of files) {
          ctx.logger.info("slide {slide}: {path}", { ...f });
        }
        const h = await ctx.writeResource("pptxExtract", `extract-${deck}`, {
          deck,
          path: args.path,
          slides: args.slides,
          files,
        });
        const j = await journal(ctx, {
          kind: "port",
          text: `extracted ${files.length} files from ${deck} slides ${
            args.slides.join(", ")
          }`,
          ref: deck,
        });
        return { dataHandles: [h, j] };
      },
    },
    pptx_layer: {
      description:
        "Export ONE PowerPoint slide with only chosen shapes (keep) or without some (drop) as PNG, via Keynote; transparent=true knocks out white. For layered animations",
      arguments: z.object({
        path: z.string(),
        slide: z.number().int().positive(),
        name: z.string().describe("Layer name, e.g. probe, bg, call_up"),
        keep: z.array(z.string()).optional().describe(
          "Shape ids to keep (see pptx_shapes)",
        ),
        drop: z.array(z.string()).optional().describe("Shape ids to drop"),
        section: z.string(),
        transparent: z.boolean().default(false),
      }),
      execute: async (
        args: {
          path: string;
          slide: number;
          name: string;
          keep?: string[];
          drop?: string[];
          section: string;
          transparent: boolean;
        },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        if (!args.keep && !args.drop) {
          throw new Error("give keep or drop shape ids");
        }
        const g = ctx.globalArgs;
        const deck = deckKey(args.path);
        const tmp = await Deno.makeTempDir({ prefix: "quarto-deck-layer-" });
        try {
          const copy = `${tmp}/${deck}_${slug(args.name)}.pptx`;
          await Deno.writeFile(
            copy,
            await layerCopy(
              await withPptx(args.path, (p) => Deno.readFile(p)),
              args.slide,
              {
                keep: args.keep,
                drop: args.drop,
              },
            ),
          );
          const pngs = await keynoteExport(copy, `${tmp}/out`);
          if (!pngs.length) throw new Error("Keynote exported nothing");
          const outRel = `${g.assetsDir}/${slug(args.section)}`;
          await Deno.mkdir(`${g.dir}/${outRel}`, { recursive: true });
          const rel = `${outRel}/${deck}_s${args.slide}_${slug(args.name)}.png`;
          if (args.transparent) await knockOutWhite(pngs[0], `${g.dir}/${rel}`);
          else await Deno.copyFile(pngs[0], `${g.dir}/${rel}`);
          ctx.logger.info("layer {name}: {rel}", { name: args.name, rel });
          const h = await ctx.writeResource(
            "layer",
            `layer-${deck}-${args.slide}-${slug(args.name)}`,
            {
              deck,
              slide: args.slide,
              name: args.name,
              keep: args.keep,
              drop: args.drop,
              path: rel,
              transparent: args.transparent,
            },
          );
          return { dataHandles: [h] };
        } finally {
          await Deno.remove(tmp, { recursive: true }).catch(() => {});
        }
      },
    },
    pptx_to_qmd: {
      description:
        "Write a .qmd stub for chosen PowerPoint slides (title, extracted images, old notes, a CHECK to sort each slide: reuse / redraw / re-crop)",
      arguments: z.object({
        path: z.string(),
        slides: z.array(z.number().int().positive()),
        file: z.string().describe(
          "Output .qmd relative to dir (must not exist)",
        ),
      }),
      execute: async (
        args: { path: string; slides: number[]; file: string },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        const deck = deckKey(args.path);
        const out = `${g.dir}/${args.file}`;
        if (await Deno.stat(out).then(() => true, () => false)) {
          throw new Error(`${args.file} exists; choose a new file`);
        }
        const inv = await inventory(await withPptx(args.path, openPptx));
        const chosen = args.slides.map((n) => {
          if (!inv[n - 1]) throw new Error(`${deck} has ${inv.length} slides`);
          return inv[n - 1];
        });
        const ex = await ctx.readResource?.(`extract-${deck}`).catch(() =>
          null
        ) as
          | { files: Array<{ slide: number; path: string }> }
          | null;
        const imgs = new Map<number, string[]>();
        for (const f of ex?.files ?? []) {
          imgs.set(f.slide, [...(imgs.get(f.slide) ?? []), f.path]);
        }
        await Deno.writeTextFile(out, qmdStub(deck, chosen, imgs));
        ctx.logger.info("wrote {file} with {n} slides", {
          file: args.file,
          n: chosen.length,
        });
        const j = await journal(ctx, {
          kind: "port",
          text: `stubbed ${deck} slides ${
            args.slides.join(", ")
          } into ${args.file}`,
          ref: deck,
        });
        return { dataHandles: [j] };
      },
    },
    export_pptx: {
      description:
        "PowerPoint version of the built deck: one full-bleed image per slide (all fragments shown) with the speaker notes. Looks exactly as rendered; not editable",
      arguments: z.object({
        out: z.string().optional().describe(
          "Output .pptx (default: next to the deck)",
        ),
        scale: z.number().default(1.5).describe(
          "Screenshot scale (1.5 → 1920×1080)",
        ),
        store: z.boolean().default(true),
      }),
      execute: async (
        args: { out?: string; scale: number; store: boolean },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        const html = htmlPath(g.dir, g.main);
        await Deno.stat(html).catch(() => {
          throw new Error(`${html} not found — run render first`);
        });
        const slides = await captureSlides({
          html,
          chrome: g.chrome,
          scale: args.scale,
        });
        const o = outlineDeck(g.dir, g.main, null);
        const bytes = await imagePptx(slides, { title: o.title ?? undefined });
        const out = args.out ?? html.replace(/\.html$/, ".pptx");
        await Deno.writeFile(out, bytes);
        ctx.logger.info("{out}: {n} slides, {mb} MB", {
          out,
          n: slides.length,
          mb: (bytes.length / 1e6).toFixed(1),
        });
        const handles = [
          await ctx.writeResource("pptxInfo", "pptx-info", {
            path: out,
            slides: slides.length,
            withNotes: slides.filter((s) => s.notes).length,
            bytes: bytes.length,
            exportedAt: new Date().toISOString(),
          }),
        ];
        if (args.store) {
          handles.push(
            await ctx.createFileWriter("pptx", "deck-pptx").writeAll(bytes),
          );
        }
        return { dataHandles: handles };
      },
    },
  },
};

// Log every method on entry (each logs its own result on completion).
for (const [name, m] of Object.entries(model.methods)) {
  const run = m.execute as (
    args: unknown,
    ctx: DeckContext,
  ) => Promise<unknown>;
  (m as { execute: unknown }).execute = (args: unknown, ctx: DeckContext) => {
    ctx.logger.info("{method} on {main} in {dir}", {
      method: name,
      main: ctx.globalArgs.main,
      dir: ctx.globalArgs.dir,
    });
    return run(args, ctx);
  };
}
