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
import {
  cutLines,
  type DeckOutline,
  issueSlide,
  learningOutcomes,
  outlineDeck,
} from "./outline.ts";
import {
  CutViewSchema,
  OutcomeReportSchema,
  StyleIssueSchema,
} from "./outline_schema.ts";
import { checkDeck, contactSheets } from "./check.ts";
import { MAC_CHROME } from "./chrome.ts";
import { shrinkPdf } from "./pdf.ts";
import { exportDeckPdf, ExportPdfInfoSchema } from "./export.ts";
import { serveDeck, ServeInfoSchema, stopServe } from "./serve.ts";
import {
  type BuildRecord,
  hashInputs,
  renderDeck,
  renderInputs,
  toolVersions,
} from "./render.ts";
import {
  type FigureRecord,
  pageTexts,
  parsePpm,
  pngSize,
  renderPage,
  renderPpm,
  searchPages,
  slug,
} from "./sources.ts";
import { refreshRefs, replaceNumberedList } from "./refs.ts";
import { slideSpan, snapshot } from "./edit.ts";
import {
  citationFromMeta,
  drawGrid,
  encodePng,
  ensureSource,
  type FigCtx,
  figureCrop,
  figureFromImage,
  findPaper,
  type JournalFn,
  referenceFromMeta,
  registerSource,
  verifyNumbers,
} from "./figures.ts";
import { captureSlides } from "./check.ts";
import { editMethods, editResources } from "./edit.ts";
import { deckPalette } from "./brand.ts";
import {
  templateFileSpecs,
  templateMethods,
  templateResources,
} from "./templates.ts";
import { imagePptx } from "./export_pptx.ts";
import {
  slideMapFiles,
  slideMapMethods,
  slideMapResources,
} from "./slidemap.ts";
import {
  insertSlide,
  paperSlide,
  PATTERN_KINDS,
  type PatternKind,
  PATTERNS,
  patternSlide,
  sectionSlide,
  statementSlide,
} from "./slides.ts";

const SLIDE_KINDS = ["paper", "section", "statement", ...PATTERN_KINDS] as [
  string,
  ...string[],
];
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
  highlightAuthor: z.string().optional().describe(
    "Surname of the lecturer (e.g. 'van Dam'): bolded in every .src line and reference of a paper they co-authored",
  ),
  sourcesDir: z.string().default("sources").describe(
    "Where source PDFs are kept, relative to dir",
  ),
  assetsDir: z.string().default("assets").describe(
    "Where slide images go, relative to dir",
  ),
  papersDir: z.string().default("~/papers").describe(
    "Local paper library: <doi with / as _>.pdf with a .json of metadata; source_add/figure_crop register from here",
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
  sections: z.array(z.object({
    title: z.string(),
    slide: z.number().nullable(),
    slides: z.number(),
    minutes: z.number(),
  })),
  styleIssues: z.array(StyleIssueSchema),
  suppressed: z.array(StyleIssueSchema),
  outcomes: OutcomeReportSchema.nullable(),
  cut: CutViewSchema,
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
  logoOverlapPx: z.number().optional(),
  logoOverlapElement: z.string().optional(),
  logoFitMaxHeight: z.number().optional(),
});

const CheckSchema = z.object({
  html: z.string(),
  slideCount: z.number(),
  overflowing: z.array(SlideCheckSchema),
  logoOverlaps: z.array(SlideCheckSchema).optional(),
  menuCoveredBy: z.string().nullable().optional(),
  slides: z.array(SlideCheckSchema),
  width: z.number(),
  height: z.number(),
  sheets: z.number(),
  checkedAt: z.string(),
});

const PdfInfoSchema = ExportPdfInfoSchema;

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
  meta: z.object({
    authors: z.array(z.string()),
    title: z.string().nullable(),
    journal: z.string().nullable(),
    year: z.number().nullable(),
    volume: z.string().nullable(),
    page: z.string().nullable(),
  }).optional(),
  reference: z.string().nullable().optional(),
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
  pxPerPt: z.number().optional().describe(
    "dpi/72: pixel (px,py) in the PNG is point (boxPt.x + px/pxPerPt, boxPt.y + py/pxPerPt)",
  ),
  anchor: z.record(z.string(), z.unknown()).optional(),
  anchorEdges: z.record(z.string(), z.string()).optional(),
  path: z.string(),
  widthPx: z.number(),
  heightPx: z.number(),
  sha256: z.string(),
  createdAt: z.string(),
});

const ImageSchema = z.object({
  label: z.string(),
  section: z.string(),
  original: z.string(),
  kept: z.string(),
  sourceSha256: z.string(),
  imageWidthPx: z.number(),
  imageHeightPx: z.number(),
  /** EXIF orientation applied before the crop (1 = none). */
  exifOrientation: z.number().optional(),
  boxPx: BoxSchema.nullable(),
  credit: z.string(),
  rights: z.string().nullable(),
  path: z.string(),
  widthPx: z.number(),
  heightPx: z.number(),
  sha256: z.string(),
  createdAt: z.string(),
});

const NumbersSchema = z.object({
  slides: z.array(z.object({
    title: z.string(),
    file: z.string(),
    line: z.number(),
    doi: z.string().nullable(),
    paper: z.string().nullable(),
    note: z.string().nullable(),
    numbers: z.array(z.object({
      text: z.string(),
      value: z.string(),
      unit: z.string(),
      where: z.enum(["shown", "src", "notes"]),
      status: z.enum(["found", "number-only", "not-found"]),
      sentence: z.string().nullable(),
    })),
  })),
  checkedAt: z.string(),
});

const AnchorSchema = z.object({
  from: z.string().describe(
    "Word at the figure's top-left, usually the panel label ('c'); a phrase or /regex/",
  ),
  to: z.string().optional().describe(
    "Word just below the figure, usually the caption start ('Figure 3'); excluded",
  ),
  left: z.string().optional().describe("Word at the left edge (kept)"),
  right: z.string().optional().describe(
    "Word at the right edge (kept); default: the next panel label on the row",
  ),
  near: z.object({ x: z.number(), y: z.number() }).optional().describe(
    "Pick the 'from' match nearest this point (pt) when it occurs more than once",
  ),
  pad: z.number().min(0).optional().describe("Margin in points (default 4)"),
  w: z.number().positive().optional().describe("Width in pt instead of right"),
  h: z.number().positive().optional().describe("Height in pt instead of to"),
  panels: z.enum(["one", "all"]).optional().describe(
    "one (default): stop at the next panel label below/right; all: ignore panel labels and run to `to` (several panels, e.g. Fig. 1a-b)",
  ),
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
  kind: z.enum(SLIDE_KINDS),
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

/** Journal adapter for the figure methods in figures.ts. */
const figJournal: JournalFn = (c, ...e) => journal(c as DeckContext, ...e);
const figCtx = (ctx: DeckContext) => ctx as unknown as FigCtx;

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
    (o.missingIncludes.length
      ? `${o.missingIncludes.length} missing files, `
      : "") +
    `${o.styleIssues.filter((x) => x.level === "rule").length} style issues ` +
    `(+${o.styleIssues.filter((x) => x.level === "hint").length} hints, ` +
    `${o.suppressed?.length ?? 0} suppressed)`;
}

/** Model definition. */
export const model = {
  type: "@vcjdeboer/quarto-deck/deck",
  version: "2026.11.20.1",
  upgrades: [
    {
      toVersion: "2026.10.23.1",
      description:
        "House-style lint in outline, figure_crop trim, .key input; global arguments unchanged",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.23.2",
      description:
        "Planned minutes per section in outline; global arguments unchanged",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.20.1",
      description:
        "Deck tooling (export_pdf, serve, slide_map, edits, templates); new global argument papersDir has a default",
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
    refsUpdate: {
      description:
        "refs_update: the .src / Ref: lines rebuilt (or that would be) from paper metadata",
      schema: z.object({
        applied: z.boolean(),
        changes: z.array(z.object({
          file: z.string(),
          line: z.number(),
          slide: z.string(),
          from: z.string(),
          to: z.string(),
        })),
        skipped: z.array(z.string()),
        backup: z.string().nullable(),
        at: z.string(),
      }),
      lifetime: "infinite" as const,
      garbageCollection: 10,
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
    image: {
      description:
        "An image (screenshot, publisher figure, photo) cropped into the deck assets, with credit and rights",
      schema: ImageSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    numbers: {
      description: "Numbers on slides checked against the cited paper's text",
      schema: NumbersSchema,
      lifetime: "30d",
      garbageCollection: 5,
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
      description:
        "Exported PDF hand-out: parts (path, pages, size, first/last title), verification against the live slide count",
      schema: PdfInfoSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    ...editResources,
    ...slideMapResources,
    ...templateResources,
    serveInfo: {
      description: "Local static server for the deck folder and the deck URLs",
      schema: ServeInfoSchema,
      lifetime: "7d",
      garbageCollection: 3,
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
    ...slideMapFiles,
    ...templateFileSpecs,
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
        const o = outlineDeck(
          g.dir,
          g.main,
          g.slotMinutes ?? null,
          g.highlightAuthor,
        );
        ctx.logger.info(outlineSummary(o));
        for (const m of o.missingIncludes) {
          ctx.logger.info("missing file: {m}", { m });
        }
        for (const x of o.styleIssues.filter((i) => i.level === "rule")) {
          ctx.logger.info(
            'style [{id}] {at} "{title}" ({file}:{line}): {message}',
            { ...x, at: issueSlide(x) },
          );
        }
        for (const line of cutLines(o.cut)) {
          ctx.logger.info("time: {line}", { line });
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
        const o = outlineDeck(
          g.dir,
          g.main,
          g.slotMinutes ?? null,
          g.highlightAuthor,
        );
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
        if (check.menuCoveredBy) {
          ctx.logger.info(
            "warning: the menu button (three stripes) is covered by {el}; clicks do not reach it",
            { el: check.menuCoveredBy },
          );
        }
        for (const s of check.logoOverlaps) {
          ctx.logger.info(
            'slide {n} "{t}": {el} runs under the logo ({px}px){fit}',
            {
              n: s.n,
              t: s.title,
              px: s.logoOverlapPx,
              el: s.logoOverlapElement,
              fit: s.logoFitMaxHeight
                ? `; slide_edit slide=${s.n} maxHeight=${s.logoFitMaxHeight} clears it`
                : "",
            },
          );
        }
        ctx.logger.info(
          "{n} slides, {o} overflowing, {l} under the logo, {k} sheets",
          {
            n: check.slideCount,
            o: check.overflowing.length,
            l: check.logoOverlaps.length,
            k: nSheets,
          },
        );
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
        "Hand-out PDF from screenshots: walk the live reveal.js slides in headless Chrome (all fragments shown, no controls), one 1280x720 page per slide, optionally split into parts; verifies page count = live slide count and writes a contact sheet per part",
      arguments: z.object({
        split: z.union([z.array(z.number().int().positive()), z.string()])
          .optional().describe(
            'Split into parts: a list of 1-based start pages ([1,30] or "30,60"), "sections" (at # dividers) or "at:<n>"',
          ),
        suffix: z.string().optional().describe(
          "Appended to file names: 18nov2026 -> glycolysis_18nov2026.pdf / glycolysis_part1_18nov2026.pdf",
        ),
        outDir: z.string().optional().describe(
          "Where the PDFs and contact sheets go (default: the deck folder)",
        ),
        scale: z.number().min(1).max(4).default(2).describe(
          "Device scale factor (2 -> 2560x1440 per page)",
        ),
        format: z.enum(["png", "jpeg"]).default("png").describe(
          "Screenshot format; jpeg gives much smaller PDFs",
        ),
        quality: z.number().min(10).max(100).default(90).describe(
          "JPEG quality (format=jpeg only)",
        ),
        shrink: z.boolean().default(false).describe(
          "Also recompress each PDF with the macOS Quartz filter",
        ),
        sheets: z.boolean().default(true).describe(
          "Write a contact sheet PNG per part next to its PDF",
        ),
        store: z.boolean().default(false).describe(
          "Also keep the PDFs as swamp data",
        ),
      }),
      execute: async (
        args: {
          split?: string | number[];
          suffix?: string;
          outDir?: string;
          scale: number;
          format: "png" | "jpeg";
          quality: number;
          shrink: boolean;
          sheets: boolean;
          store: boolean;
        },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        const html = htmlPath(g.dir, g.main);
        await Deno.stat(html).catch(() => {
          throw new Error(`${html} not found — run render first`);
        });
        const r = await exportDeckPdf({
          html,
          outDir: args.outDir ?? g.dir,
          base: html.split("/").pop()!.replace(/\.html$/, ""),
          split: args.split,
          suffix: args.suffix,
          scale: args.scale,
          format: args.format,
          quality: args.quality,
          chrome: g.chrome,
          sheets: args.sheets,
          log: (m, p) => ctx.logger.info(m, p),
        });
        if (args.shrink && Deno.build.os === "darwin") {
          for (const p of r.parts) {
            const small = p.path.replace(/\.pdf$/, ".shrunk.tmp.pdf");
            const size = await shrinkPdf({ input: p.path, out: small });
            if (size < p.bytes) {
              await Deno.rename(small, p.path);
              p.bytes = size;
            } else await Deno.remove(small).catch(() => {});
          }
        }
        for (const p of r.parts) {
          ctx.logger.info(
            'part {k}: {path}, {pages} pages, {mb} MB, "{first}" .. "{last}"',
            {
              k: p.part,
              path: p.path,
              pages: p.pages,
              mb: (p.bytes / 1e6).toFixed(1),
              first: p.firstTitle,
              last: p.lastTitle,
            },
          );
        }
        ctx.logger.info(
          "verified: {pages} pages = {n} live slides{rep}",
          {
            pages: r.verification.pagesTotal,
            n: r.liveSlides,
            rep: r.verification.repeatedPages.length
              ? `; WARNING identical consecutive pages: ${
                r.verification.repeatedPages.join(", ")
              }`
              : "",
          },
        );
        const { slides: _slides, ...info } = r;
        const handles = [
          await ctx.writeResource("pdfInfo", "pdf-info", {
            ...info,
            path: r.parts[0].path,
            pages: r.verification.pagesTotal,
            bytes: r.parts.reduce((a, p) => a + p.bytes, 0),
            exportedAt: new Date().toISOString(),
          }),
        ];
        if (args.store) {
          for (const p of r.parts) {
            handles.push(
              await ctx.createFileWriter("pdf", `deck-pdf-${p.part}`).writeAll(
                await Deno.readFile(p.path),
              ),
            );
          }
        }
        return { dataHandles: handles };
      },
    },
    serve: {
      description:
        "Serve the deck folder on http://127.0.0.1:<port> (reuse a server already serving it, else start a detached one) and return the URLs of the built HTML decks; stop=true stops it",
      arguments: z.object({
        port: z.number().int().min(1024).max(65535).default(8765),
        python: z.string().default("python3").describe(
          "Python used for the static server (python -m http.server)",
        ),
        stop: z.boolean().default(false).describe(
          "Stop this deck's server on the port instead of starting one",
        ),
      }),
      execute: async (
        args: { port: number; python: string; stop: boolean },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        if (args.stop) {
          const stopped = await stopServe({ dir: g.dir, port: args.port });
          ctx.logger.info("port {port}: {what}", {
            port: args.port,
            what: stopped.length
              ? `stopped pid ${stopped.join(", ")}`
              : "no server was running",
          });
          return {
            dataHandles: [
              await ctx.writeResource("serveInfo", "serve", {
                dir: g.dir.replace(/\/$/, ""),
                port: args.port,
                reused: false,
                pid: null,
                main: null,
                urls: [],
                servedAt: new Date().toISOString(),
                stopped,
              }),
            ],
          };
        }
        const r = await serveDeck({
          dir: g.dir,
          port: args.port,
          mainHtml: htmlPath(g.dir, g.main).split("/").pop(),
          python: args.python,
        });
        ctx.logger.info("{how} server on port {port}: {url}", {
          how: r.reused ? "reused" : `started (pid ${r.pid})`,
          port: r.port,
          url: r.main ?? r.urls[0].url,
        });
        for (const u of r.urls) {
          ctx.logger.info("{url} -> {status}", { ...u });
        }
        return {
          dataHandles: [
            await ctx.writeResource("serveInfo", "serve", {
              ...r,
              servedAt: new Date().toISOString(),
            }),
          ],
        };
      },
    },
    source_add: {
      description:
        "Register a paper PDF as a deck source: copy it into sourcesDir, record citation, DOI, checksum, pages and the figure/table caption index. Without pdf, finds <doi with / as _>.pdf (and its .json metadata) in papersDir by doi or key",
      arguments: z.object({
        pdf: z.string().optional().describe(
          "Path of the PDF; omit to look it up in papersDir by doi or key",
        ),
        key: z.string().optional().describe(
          "Short key, e.g. sbarra1959; default first author + year from the .json",
        ),
        citation: z.string().optional().describe(
          "Source line as it should appear on the slide, e.g. 'Sbarra & Karnovsky, J Biol Chem 1959'; default from the .json",
        ),
        doi: z.string().optional(),
      }),
      execute: async (
        args: { pdf?: string; key?: string; citation?: string; doi?: string },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const { handles } = await registerSource(
          figCtx(ctx),
          figJournal,
          args,
        );
        return { dataHandles: handles };
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
        const { rec, handles } = await ensureSource(
          figCtx(ctx),
          figJournal,
          args.key,
        );
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
        return { dataHandles: [...handles, h] };
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
        grid: z.boolean().default(true).describe(
          "Draw a coordinate grid in PDF points (line every 50 pt, labelled every 100 pt) to read crop boxes off",
        ),
      }),
      execute: async (
        args: {
          key: string;
          page: number;
          dpi: number;
          outPng?: string;
          grid: boolean;
        },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const { rec, handles } = await ensureSource(
          figCtx(ctx),
          figJournal,
          args.key,
        );
        if (args.page > rec.pages) {
          throw new Error(`${rec.key} has ${rec.pages} pages`);
        }
        const pdf = `${ctx.globalArgs.dir}/${rec.stored}`;
        let png: Uint8Array;
        const size = rec.pageSizes.find((p) => p.page === args.page);
        if (args.grid && size) {
          const s = args.dpi / 72;
          const img = parsePpm(
            await renderPpm({
              pdf,
              page: args.page,
              dpi: args.dpi,
              cropPx: {
                x: 0,
                y: 0,
                W: Math.ceil(size.width * s),
                H: Math.ceil(size.height * s),
              },
            }),
          );
          drawGrid(img, args.dpi);
          png = await encodePng(img);
        } else {
          png = await renderPage({ pdf, page: args.page, dpi: args.dpi });
        }
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
        return { dataHandles: [...handles, h] };
      },
    },
    figure_crop: {
      description:
        "Crop a figure/table from a source page into assets/<section>/<key>_<label>.png and record its provenance (page, box, dpi, checksums). Place the box with anchor words (panel label → caption start) instead of guessing; preview=true draws the box on the page first. An unregistered key or DOI found in papersDir is registered on the fly",
      arguments: z.object({
        key: z.string().describe(
          "Source key, or a DOI / key found in papersDir",
        ),
        page: z.number().int().positive(),
        box: BoxSchema.optional().describe(
          "Crop box from the top-left: x, y, w, h in PDF points, or all four as fractions (0–1) of the page",
        ),
        anchor: AnchorSchema.optional().describe(
          "Instead of box: words that bound the figure, resolved with pdftotext -bbox-layout",
        ),
        label: z.string().describe("e.g. table1, fig2D"),
        section: z.string().describe("Asset sub-folder, e.g. history"),
        dpi: z.number().default(200).describe(
          "Output resolution; the PNG always has dpi/72 px per point, trimmed or not",
        ),
        trim: z.boolean().default(false).describe(
          "Shrink the box to the ink inside it (give a generous box)",
        ),
        pad: z.number().min(0).default(4).describe(
          "Margin kept around the ink when trimming, in points",
        ),
        preview: z.boolean().default(false).describe(
          "Draw the box (red) and anchors (blue) on the page and write that PNG instead of cropping",
        ),
        previewDpi: z.number().default(100),
        outPng: z.string().optional().describe(
          "preview: where to write the PNG (default a temp file, logged)",
        ),
      }),
      execute: async (
        args: {
          key: string;
          page: number;
          box?: { x: number; y: number; w: number; h: number };
          anchor?: z.infer<typeof AnchorSchema>;
          label: string;
          section: string;
          dpi: number;
          trim: boolean;
          pad: number;
          preview?: boolean;
          previewDpi?: number;
          outPng?: string;
        },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        return await figureCrop(figCtx(ctx), figJournal, {
          ...args,
          preview: args.preview ?? false,
          previewDpi: args.previewDpi ?? 100,
        });
      },
    },
    figure_from_image: {
      description:
        "Crop an image that is not a paper PDF (screenshot, publisher gr1_lrg.jpg, photo) into assets/<section>/<label>.png with ffmpeg; keeps the original in sourcesDir/images and records credit, rights and the pixel box",
      arguments: z.object({
        image: z.string().describe("PNG or JPEG path (spaces fine)"),
        box: BoxSchema.optional().describe(
          "Crop box in pixels from the top-left, or all four as fractions (0–1); omit for the whole image",
        ),
        label: z.string().describe("File name, e.g. newspaper1924_lactate"),
        section: z.string().describe("Asset sub-folder"),
        credit: z.string().describe(
          "Who made it / where from, e.g. 'A. van Dam, unpublished' or 'newspaper photo, 1924'",
        ),
        rights: z.string().optional().describe(
          "Rights note, e.g. 'teaching use only'",
        ),
      }),
      execute: async (
        args: {
          image: string;
          box?: { x: number; y: number; w: number; h: number };
          label: string;
          section: string;
          credit: string;
          rights?: string;
        },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        return await figureFromImage(figCtx(ctx), figJournal, args);
      },
    },
    verify_numbers: {
      description:
        "Check the numbers with units or percent on a slide (shown text, .src, notes) against the text of the paper in the notes' DOI (registered source or papersDir). Read-only; lists each number as found, number-only (unit differs) or not-found, with the sentence",
      arguments: z.object({
        slide: z.string().optional().describe("Title substring"),
        file: z.string().optional().describe(
          "Instead of slide: every slide in this .qmd (relative to dir)",
        ),
      }),
      execute: async (
        args: { slide?: string; file?: string },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        if (!args.slide === !args.file) {
          throw new Error("give slide (title substring) or file");
        }
        const o = outlineDeck(g.dir, g.main, null);
        const want = args.slide?.toLowerCase();
        const slides = o.slides.filter((s) =>
          want ? s.title.toLowerCase().includes(want) : s.file === args.file
        );
        if (!slides.length) {
          throw new Error(`no slide matches ${args.slide ?? args.file}`);
        }
        if (want && slides.length > 1) {
          const exact = slides.filter((s) => s.title.toLowerCase() === want);
          if (exact.length !== 1) {
            throw new Error(
              `slide "${args.slide}" matches ${slides.length} slides: ${
                slides.map((s) => `"${s.title}" (${s.file}:${s.line})`).join(
                  "; ",
                )
              } — give more of the title, or file=`,
            );
          }
          slides.splice(0, slides.length, ...exact);
        }
        return await verifyNumbers(
          figCtx(ctx),
          slides,
          `numbers-${slug(args.slide ?? args.file!)}`,
        );
      },
    },
    outcomes_set: {
      description:
        "Set the learning outcomes: rewrite the numbered list on the 'Learning outcomes' slide and on 'Learning outcomes revisited' (or .lo / .lo-done) with the same items, so the two never differ. Bold **key terms** feed the coverage check. Snapshot first; journals itself",
      arguments: z.object({
        items: z.array(z.string().min(1)).min(1).describe(
          "The outcomes in order, markdown; bold the key terms",
        ),
      }),
      execute: async (
        args: { items: string[] },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        const o = outlineDeck(g.dir, g.main, null);
        const r = learningOutcomes(o.slides);
        const targets = [r?.opening, r?.closing]
          .map((n) => o.slides.find((s) => s.n === n))
          .filter((s): s is (typeof o.slides)[number] => !!s);
        if (!targets.length) {
          throw new Error(
            "no 'Learning outcomes' slide (title, or .lo / .lo-done div) in the deck",
          );
        }
        const files = [...new Set(targets.map((s) => s.file))];
        const text: Record<string, string[]> = {};
        for (const f of files) {
          text[f] = (await Deno.readTextFile(`${g.dir}/${f}`)).split("\n");
        }
        // bottom-up within a file
        for (const s of [...targets].sort((a, b) => b.line - a.line)) {
          const next = o.slides.filter((x) =>
            x.file === s.file && x.line > s.line
          )
            .reduce<number | null>(
              (m, x) => m === null || x.line < m ? x.line : m,
              null,
            );
          const span = slideSpan(text[s.file], s.line, next);
          text[s.file] = replaceNumberedList(
            text[s.file],
            span.start,
            span.end,
            args.items,
          );
        }
        const b = await snapshot(
          g.dir,
          files,
          "outcomes_set",
          "before outcomes_set",
        );
        for (const f of files) {
          await Deno.writeTextFile(`${g.dir}/${f}`, text[f].join("\n"));
        }
        const after = learningOutcomes(
          outlineDeck(g.dir, g.main, null).slides,
        );
        ctx.logger.info(
          "{n} outcomes on {k} slide(s); lists match: {m}; snapshot {b}",
          {
            n: args.items.length,
            k: targets.length,
            m: after?.match ?? "-",
            b: b.id,
          },
        );
        const j = await journal(ctx, {
          kind: "change",
          text: `outcomes_set: ${args.items.length} learning outcomes on ${
            targets.map((s) => `"${s.title}"`).join(" and ")
          }`,
          ref: `backup ${b.id}`,
        });
        return { dataHandles: [j] };
      },
    },
    refs_update: {
      description:
        "Bring the references of the existing slides into house style: for every slide whose notes cite one DOI with metadata in papersDir, rebuild the .src line (figure part kept) and the notes Ref: line from the paper's .json, with highlightAuthor in bold. apply=false (default) only lists the changes; apply=true writes them after a snapshot and journals itself",
      arguments: z.object({
        apply: z.boolean().default(false),
      }),
      execute: async (
        args: { apply: boolean },
        ctx: DeckContext,
      ): Promise<{ dataHandles: Handle[] }> => {
        const g = ctx.globalArgs;
        const o = outlineDeck(g.dir, g.main, null);
        const text: Record<string, string[]> = {};
        for (const f of o.files) {
          text[f] = (await Deno.readTextFile(`${g.dir}/${f}`)).split("\n");
        }
        const changed: Array<
          {
            file: string;
            line: number;
            slide: string;
            from: string;
            to: string;
          }
        > = [];
        const skipped: string[] = [];
        // bottom-up per file, so line numbers above stay valid
        const slides = [...o.slides].sort((a, b) =>
          a.file === b.file ? b.line - a.line : a.file < b.file ? -1 : 1
        );
        for (const s of slides) {
          const dois = [...new Set(s.dois.map((d) => d.toLowerCase()))];
          if (!s.src.length && !s.refLines.length) continue;
          if (dois.length !== 1) {
            if (s.src.length) {
              skipped.push(
                `"${s.title}" (${s.file}:${s.line}): ${
                  dois.length ? `${dois.length} DOIs` : "no DOI in the notes"
                }`,
              );
            }
            continue;
          }
          const p = await findPaper(g.papersDir ?? "~/papers", { doi: dois[0] })
            .catch(() => null);
          const meta = p?.meta;
          const base = meta ? citationFromMeta(meta, g.highlightAuthor) : null;
          const ref = meta ? referenceFromMeta(meta, g.highlightAuthor) : null;
          if (!base || !ref) {
            skipped.push(
              `"${s.title}" (${s.file}:${s.line}): no metadata for ${dois[0]}`,
            );
            continue;
          }
          const lines = text[s.file];
          const next = o.slides.filter((x) =>
            x.file === s.file && x.line > s.line
          )
            .reduce<number | null>(
              (m, x) => m === null || x.line < m ? x.line : m,
              null,
            );
          const span = slideSpan(lines, s.line, next);
          const r = refreshRefs(
            lines,
            span.start,
            span.end,
            base,
            ref,
            dois[0],
          );
          text[s.file] = r.lines;
          for (const c of r.changes) {
            changed.push({
              file: s.file,
              line: c.line + 1,
              slide: s.title,
              from: c.from,
              to: c.to,
            });
          }
        }
        changed.sort((a, b) =>
          a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1
        );
        for (const c of changed) {
          ctx.logger.info('{file}:{line} "{slide}"\n  - {from}\n  + {to}', {
            ...c,
          });
        }
        for (const s of skipped) ctx.logger.info("skipped {s}", { s });
        const files = [...new Set(changed.map((c) => c.file))];
        let backup: string | null = null;
        if (args.apply && files.length) {
          const b = await snapshot(
            g.dir,
            files,
            "refs_update",
            "before refs_update",
          );
          backup = b.id;
          for (const f of files) {
            await Deno.writeTextFile(`${g.dir}/${f}`, text[f].join("\n"));
          }
        }
        ctx.logger.info(
          "{n} reference lines {how} in {f} files; {k} slides skipped{b}",
          {
            n: changed.length,
            how: args.apply
              ? "rewritten"
              : "would change (apply=true writes them)",
            f: files.length,
            k: skipped.length,
            b: backup
              ? `; snapshot ${backup} (restore id=${backup} undoes it)`
              : "",
          },
        );
        const h = await ctx.writeResource("refsUpdate", "refs-update", {
          applied: args.apply,
          changes: changed,
          skipped,
          backup,
          at: new Date().toISOString(),
        });
        const handles = [h];
        if (args.apply && changed.length) {
          handles.push(
            await journal(ctx, {
              kind: "change",
              text:
                `refs_update: ${changed.length} reference lines rebuilt from paper metadata in ${
                  files.join(", ")
                }`,
              ref: `backup ${backup}`,
            }),
          );
        }
        return { dataHandles: handles };
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
        "Write a slide from a house pattern into a section file. paper = title is the message + ONE figure (from figure_crop) + one .src + notes with timing and full ref/DOI; section; statement; diagram patterns (structured `spec`, colours from the deck's _brand.yml, neutral defaults without one): " +
        PATTERN_KINDS.map((k) => `${k} = ${PATTERNS[k].what}`).join("; "),
      arguments: z.object({
        kind: z.enum(SLIDE_KINDS),
        spec: z.union([z.string(), z.record(z.string(), z.unknown())])
          .optional().describe(
            "Diagram patterns: the structured input (JSON), validated by the pattern; see README",
          ),
        file: z.string().describe(
          "Section .qmd relative to dir (created if missing)",
        ),
        title: z.string().describe(
          "paper: the message; section: section title; statement: the sentence (markdown ok)",
        ),
        figure: z.string().optional().describe(
          "paper: '<key>-<label>' of a figure_crop record, or 'image-<label>' of a figure_from_image record",
        ),
        image: z.string().optional().describe(
          "paper without a figure record: image path",
        ),
        citation: z.string().optional().describe(
          "Source line; only for an image without a registered paper. With a figure record of a registered paper the line is built from the paper's metadata",
        ),
        srcDetail: z.string().optional().describe(
          "Appended to the source line: 'Fig. 2A,B. Skin fibroblasts from both patients'",
        ),
        minutes: z.number().default(1),
        notes: z.string().default("").describe(
          "What you will say (speaker notes)",
        ),
        reference: z.string().optional().describe(
          "Full reference for the notes; only when the paper has no metadata. Otherwise it is built from the paper's .json (never typed from memory)",
        ),
        subtitle: z.string().optional(),
        maxHeight: z.number().optional(),
        after: z.string().optional().describe(
          "Insert after the slide whose title contains this; default: append",
        ),
      }),
      execute: async (
        args: {
          kind: string;
          spec?: string | Record<string, unknown>;
          file: string;
          title: string;
          figure?: string;
          image?: string;
          citation?: string;
          srcDetail?: string;
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
        // colours from the deck's _brand.yml (neutral defaults without one)
        const pal = await deckPalette(g.dir, g.main);
        let md: string;
        if (args.kind === "paper") {
          let image = args.image,
            citation = args.citation,
            reference = args.reference,
            doi: string | null = null;
          if (args.figure?.startsWith("image-")) {
            const img = await ctx.readResource?.(args.figure) as
              | { path: string; credit: string }
              | null;
            if (!img) {
              throw new Error(
                `no image record "${args.figure}" — run figure_from_image first`,
              );
            }
            image = img.path;
            citation = citation ?? img.credit;
          } else if (args.figure) {
            const fig = await ctx.readResource?.(`figure-${args.figure}`) as
              | FigureRecord
              | null;
            if (!fig) {
              throw new Error(
                `no figure record "${args.figure}" — run figure_crop first`,
              );
            }
            image = fig.path;
            doi = fig.doi;
            // the paper's metadata, never a typed reference
            const src = await ctx.readResource?.(`source-${fig.key}`) as
              | { meta?: Record<string, unknown> }
              | null;
            const meta = src?.meta as Parameters<typeof citationFromMeta>[0];
            const cit = meta ? citationFromMeta(meta, g.highlightAuthor) : null;
            if (cit) {
              for (
                const [arg, v] of [["citation", args.citation], [
                  "reference",
                  args.reference,
                ]]
              ) {
                if (v) {
                  ctx.logger.info(
                    "{arg} ignored: built from the paper's metadata instead",
                    { arg },
                  );
                }
              }
              citation = cit;
              reference = referenceFromMeta(meta, g.highlightAuthor) ??
                undefined;
            } else {
              citation = citation ?? fig.citation;
              ctx.logger.info(
                "warning: {key} has no metadata; source line and reference are as typed — check them against the paper",
                { key: fig.key },
              );
            }
          }
          if (citation && args.srcDetail) {
            citation = `${citation.replace(/[.,\s]+$/, "")}, ${args.srcDetail}`;
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
            reference,
            doi,
            maxHeight: args.maxHeight,
          });
        } else if (args.kind === "section") {
          md = sectionSlide(
            args.title,
            args.subtitle ?? "",
            pal.section,
            args.notes,
            args.notes.trim() ? args.minutes : undefined,
          );
        } else if (args.kind in PATTERNS) {
          const kind = args.kind as PatternKind;
          let spec: unknown = args.spec ?? {};
          if (typeof spec === "string") {
            try {
              spec = JSON.parse(spec);
            } catch (e) {
              throw new Error(`${kind} spec is not valid JSON: ${e}`);
            }
          }
          const parsed = PATTERNS[kind].schema.safeParse(spec);
          if (!parsed.success) {
            throw new Error(
              `${kind} spec: ${
                parsed.error.issues.map((i) =>
                  `${i.path.join(".") || "(root)"}: ${i.message}`
                ).join("; ")
              }`,
            );
          }
          md = patternSlide(kind, parsed.data, {
            title: args.title,
            minutes: args.minutes,
            notes: args.notes,
            citation: args.citation,
            reference: args.reference,
          }, pal);
        } else {
          md = statementSlide(args.title, args.minutes, args.notes);
        }
        const path = `${g.dir}/${args.file}`;
        const cur = await Deno.readTextFile(path).catch(() => "");
        // statements share one heading, so identify them by their sentence
        const key = args.kind === "statement"
          ? args.title
          : args.kind === "statement_image"
          ? md.split("\n").find((l) => l.startsWith("<p ")) ?? md.split("\n")[0]
          : md.split("\n")[0];
        if (hasLine(cur, key)) {
          throw new Error(
            `${args.file} already has "${key}" — edit that slide instead of adding it again`,
          );
        }
        await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), {
          recursive: true,
        });
        await Deno.writeTextFile(
          path,
          cur ? insertSlide(cur, md, args.after) : md,
        );
        // a new section file is included from the main .qmd, so the deck,
        // outline and the edit methods see it
        let included = "";
        const mainExists = await Deno.stat(`${g.dir}/${g.main}`).then(
          () => true,
          () => false,
        );
        if (
          mainExists && args.file !== g.main &&
          !outlineDeck(g.dir, g.main).files.includes(args.file)
        ) {
          const mainDir = g.main.includes("/")
            ? g.main.slice(0, g.main.lastIndexOf("/") + 1)
            : "";
          const incl = args.file.startsWith(mainDir)
            ? args.file.slice(mainDir.length)
            : args.file;
          const mainPath = `${g.dir}/${g.main}`;
          const text = await Deno.readTextFile(mainPath);
          await Deno.writeTextFile(
            mainPath,
            `${text.replace(/\s*$/, "")}\n\n{{< include ${incl} >}}\n`,
          );
          included = `; included ${incl} at the end of ${g.main}`;
          ctx.logger.info("{f} was not part of the deck: {how}", {
            f: args.file,
            how: `appended {{< include ${incl} >}} to ${g.main}`,
          });
        }
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
          }${included}`,
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
    // slide_insert, slide_move, slide_delete, slide_replace_image,
    // backup_list, restore (edit.ts)
    ...editMethods((ctx, entry) => journal(ctx as DeckContext, entry)),
    ...slideMapMethods,
    // template_list, deck_init, template_apply, template_preview (templates.ts)
    ...templateMethods((ctx, entry) => journal(ctx as DeckContext, entry)),
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
