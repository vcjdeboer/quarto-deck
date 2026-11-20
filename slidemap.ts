/**
 * Slide map and single-slide view: one numbering for the deck, the one the
 * audience sees in the slide counter.
 *
 * The counter of the built deck counts `Reveal.getSlides()`: the title slide
 * Quarto makes from the front matter, then every slide that is not
 * `{visibility="hidden"}` (Quarto drops those from the HTML). `buildSlideMap`
 * derives that number from the parsed source; `compareWithHtml` confirms it
 * against the section ids of the built HTML. `viewSlide` screenshots one slide
 * in headless Chrome, navigating with the Reveal API.
 *
 * Pure functions first; `deckSlideMap`/`viewSlide` add the IO; the method
 * specs at the bottom are spread into the model in `quarto_deck.ts`.
 * @module
 */
import { z } from "npm:zod@4";
import {
  audienceText,
  expandIncludes,
  parseHeading,
  parseQmd,
  type SlideInfo,
  type SourceLine,
} from "./outline.ts";
import { launchChrome, MAC_CHROME, waitForReveal } from "./chrome.ts";
import { MEASURE } from "./check.ts";

/** What kind of slide a row is. */
export type SlideKind =
  | "title"
  | "section"
  | "exercise"
  | "paper"
  | "diagram"
  | "statement"
  | "plain"
  | "image"
  | "content";

/** One slide, numbered as the audience sees it. */
export interface SlideMapRow {
  /** Number in the slide counter; null for hidden slides (not in the HTML). */
  shown: number | null;
  /** 1-based position in source order as `outline` numbers it; 0 = title slide. */
  source: number;
  title: string;
  kind: SlideKind;
  hidden: boolean;
  file: string;
  line: number;
  /** Enclosing `#` section ("Opening" before the first one). */
  section: string;
  minutes: number | null;
  /** Section id pandoc gives the slide; what the HTML should contain. */
  id: string;
}

/** Result of comparing the map with the built HTML. */
export interface HtmlAgreement {
  html: string;
  exists: boolean;
  /** HTML older than one of the source files. */
  stale: boolean;
  htmlSlides: number;
  shownSlides: number;
  agrees: boolean;
  mismatches: Array<{ shown: number; expected: string; actual: string }>;
}

const DISPLAY_LEN = 60;

/** Shorten to `n` characters on a word boundary, with an ellipsis. */
export function clip(s: string, n = DISPLAY_LEN): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:]+$/, "") +
    "…";
}

/**
 * Pandoc's automatic identifier for a heading (before de-duplication):
 * formatting stripped, everything but letters, digits, `_`, `-`, `.` removed,
 * spaces to hyphens, lowercased, leading non-letters dropped, "section" when
 * nothing is left. An explicit `{#id}` wins.
 */
export function pandocId(rawHeading: string): string {
  const attrs = rawHeading.match(/\{([^{}]*)\}\s*$/)?.[1] ?? "";
  const explicit = attrs.replace(/"[^"]*"|'[^']*'/g, "")
    .match(/(?:^|\s)#([\w:.-]+)/);
  if (explicit) return explicit[1];
  const { title } = parseHeading(rawHeading);
  const plain = title
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\{[^}]*\}/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const id = plain
    .replace(/[^\p{L}\p{N}_\-. ]/gu, "")
    .replace(/ /g, "-")
    .toLowerCase()
    .replace(/^[^\p{L}]+/u, "");
  return id || "section";
}

/** De-duplicate ids the way pandoc does: `x`, `x-1`, `x-2`, … */
export function dedupeIds(ids: string[]): string[] {
  const used = new Set<string>();
  return ids.map((base) => {
    let id = base;
    for (let k = 1; used.has(id); k++) id = `${base}-${k}`;
    used.add(id);
    return id;
  });
}

/**
 * Kind of a parsed slide. `source` is the slide's full source text (div
 * markers included, which `SlideInfo.body` leaves out).
 */
export function slideKind(s: SlideInfo, source = s.body.join("\n")): SlideKind {
  if (s.level === 1) return "section";
  if (/^:{3,}\s*\{?[^}\n]*\.(task|exam)\b/m.test(source)) return "exercise";
  // a drawn diagram (inline SVG, no image) is not a paper figure, even with a
  // `.src` line for the model it summarises
  const diagram = /<svg\b/.test(source) && s.images.length === 0 &&
    !/<img\b/.test(source);
  if (s.src.length > 0 && !diagram) return "paper";
  if (s.classes.includes("statement")) return "statement";
  if (s.classes.includes("plain")) return "plain";
  if (diagram) return "diagram";
  if (!s.title && audienceText(s).length === 0) {
    return "image";
  }
  return "content";
}

/**
 * Title to show for a slide: the heading, else the SVG `aria-label`, else the
 * first ~60 characters of its shown text, else "[section divider]" / "[image]".
 */
export function displayTitle(s: SlideInfo, rawHeading = ""): string {
  if (s.title) return s.title.replace(/\s+/g, " ").trim();
  if (s.level === 1) return "[section divider]";
  const aria = s.body.join("\n").match(/<svg\b[^>]*\baria-label="([^"]+)"/);
  if (aria) return clip(aria[1]);
  const shown = audienceText(s).join(" ");
  if (shown) return clip(shown);
  // text written as raw HTML (`<p>…</p>`), which audienceText leaves out
  const html = s.body.join(" ")
    .replace(/<(svg|style|script)\b[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/[*_`]/g, "")
    .replace(/\s+([,.;:!?])/g, "$1");
  if (html.trim()) return clip(html);
  if (
    s.images.length || /background-(image|video)=/.test(rawHeading) ||
    s.body.some((l) => /<(img|svg|video)\b/.test(l))
  ) return "[image]";
  return "[untitled]";
}

/** 1-based line of `title:` in the front matter of `main`, or 1. */
export function titleLine(lines: SourceLine[], main: string): number {
  const own = lines.filter((l) => l.file === main);
  if (own[0]?.text.trim() !== "---") return 1;
  for (let i = 1; i < own.length && own[i].text.trim() !== "---"; i++) {
    if (/^title:/.test(own[i].text)) return own[i].line;
  }
  return 1;
}

/**
 * Number the slides as the slide counter does. The title slide (when the
 * front matter has a title) is 1; hidden slides get no number.
 */
export function buildSlideMap(
  lines: SourceLine[],
  main: string,
  parsed: ReturnType<typeof parseQmd> = parseQmd(lines),
): SlideMapRow[] {
  const at = new Map(lines.map((l, i) => [`${l.file}:${l.line}`, i]));
  const start = (s: SlideInfo) => at.get(`${s.file}:${s.line}`) ?? -1;
  const raw = (s: SlideInfo) =>
    (lines[start(s)]?.text ?? "").replace(/^#{1,2}\s+/, "");
  const sourceOf = (k: number) => {
    const from = start(parsed.slides[k]);
    const next = parsed.slides[k + 1];
    const to = next ? start(next) : lines.length;
    return from < 0 ? undefined : lines.slice(from + 1, to).map((l) => l.text)
      .join("\n");
  };
  const ids = dedupeIds(parsed.slides.map((s) => pandocId(raw(s))));
  const rows: SlideMapRow[] = [];
  let shown = 0;
  if (parsed.title !== null) {
    rows.push({
      shown: ++shown,
      source: 0,
      title: parsed.title.replace(/\s+/g, " ").trim(),
      kind: "title",
      hidden: false,
      file: main,
      line: titleLine(lines, main),
      section: "Opening",
      minutes: null,
      id: "title-slide",
    });
  }
  let section = "Opening";
  parsed.slides.forEach((s, i) => {
    if (s.level === 1 && !s.hidden) section = s.title || "[untitled section]";
    rows.push({
      shown: s.hidden ? null : ++shown,
      source: s.n,
      title: displayTitle(s, raw(s)),
      kind: slideKind(s, sourceOf(i)),
      hidden: s.hidden,
      file: s.file,
      line: s.line,
      section,
      minutes: s.minutes,
      id: ids[i],
    });
  });
  return rows;
}

/** Ids of the slides in a built reveal.js HTML, in deck order. */
export function htmlSlideIds(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<section\b([^>]*)>/g)) {
    const attrs = m[1];
    const id = attrs.match(/\bid="([^"]*)"/)?.[1];
    const cls = attrs.match(/\bclass="([^"]*)"/)?.[1] ?? "";
    if (id === "title-slide" || (id && /\bslide\b/.test(cls))) out.push(id);
  }
  return out;
}

/** Compare the map's shown slides with the ids found in the HTML. */
export function compareWithHtml(
  rows: SlideMapRow[],
  ids: string[],
): Pick<HtmlAgreement, "htmlSlides" | "shownSlides" | "agrees" | "mismatches"> {
  const shown = rows.filter((r) => r.shown !== null);
  const mismatches: HtmlAgreement["mismatches"] = [];
  const n = Math.max(shown.length, ids.length);
  for (let k = 0; k < n; k++) {
    const expected = shown[k]?.id ?? "(none)";
    const actual = ids[k] ?? "(none)";
    if (expected !== actual) {
      mismatches.push({ shown: k + 1, expected, actual });
    }
  }
  return {
    htmlSlides: ids.length,
    shownSlides: shown.length,
    agrees: mismatches.length === 0,
    mismatches,
  };
}

/** Rows to print: `query` filters on title, `around` keeps shown n±3. */
export function selectRows(
  rows: SlideMapRow[],
  opts: { query?: string; around?: number } = {},
): SlideMapRow[] {
  let out = rows;
  if (opts.around !== undefined) {
    const a = opts.around;
    // hidden rows sit between their shown neighbours
    let first = rows.findIndex((r) => r.shown !== null && r.shown >= a - 3);
    let last = rows.findLastIndex((r) => r.shown !== null && r.shown <= a + 3);
    if (first < 0) first = rows.length;
    if (last < 0) last = -1;
    out = out.filter((_, i) => i >= first && i <= last);
  }
  if (opts.query) {
    const q = opts.query.toLowerCase();
    out = out.filter((r) => r.title.toLowerCase().includes(q));
  }
  return out;
}

/** Compact text table of rows, with a line where the section changes. */
export function formatSlideMap(rows: SlideMapRow[]): string {
  const loc = (r: SlideMapRow) => `${r.file}:${r.line}`;
  const w = Math.max(9, ...rows.map((r) => loc(r).length));
  const out = [
    `${"#".padStart(4)}  ${"kind".padEnd(9)} ${"min".padStart(4)}  ${
      "file:line".padEnd(w)
    }  title`,
  ];
  let section: string | null = null;
  for (const r of rows) {
    if (r.section !== section) {
      section = r.section;
      out.push(`--- ${section}`);
    }
    const num = r.shown === null ? "-" : String(r.shown);
    const min = r.minutes === null
      ? ""
      : String(Math.round(r.minutes * 10) / 10);
    const kind = r.hidden ? "hidden" : r.kind;
    out.push(
      `${num.padStart(4)}  ${kind.padEnd(9)} ${min.padStart(4)}  ${
        loc(r).padEnd(w)
      }  ${clip(r.title)}`,
    );
  }
  return out.join("\n");
}

/**
 * Pick one slide by shown number or title substring. A title matching several
 * slides takes the first and lists the rest in `others`.
 */
export function findSlide(
  rows: SlideMapRow[],
  sel: { n?: number; title?: string },
): { row: SlideMapRow; others: SlideMapRow[] } {
  if (sel.n !== undefined) {
    const row = rows.find((r) => r.shown === sel.n);
    const max = rows.filter((r) => r.shown !== null).length;
    if (!row) throw new Error(`no slide ${sel.n}; the deck shows 1–${max}`);
    return { row, others: [] };
  }
  if (sel.title) {
    const q = sel.title.toLowerCase();
    const hits = rows.filter((r) => r.title.toLowerCase().includes(q));
    const shown = hits.filter((r) => r.shown !== null);
    if (!shown.length) {
      throw new Error(
        hits.length
          ? `"${sel.title}" matches only hidden slides (${
            hits.map((r) => `${r.file}:${r.line}`).join(", ")
          }), which are not in the built deck`
          : `no slide title contains "${sel.title}"`,
      );
    }
    return { row: shown[0], others: shown.slice(1) };
  }
  throw new Error("give n (the shown slide number) or title");
}

// ---------------------------------------------------------------- IO

function join(dir: string, p: string): string {
  return p.startsWith("/") ? p : `${dir.replace(/\/$/, "")}/${p}`;
}

/** Path of the HTML Quarto writes for `main` (same rule as `htmlPath`). */
function htmlFor(dir: string, main: string): string {
  return join(dir, main.replace(/\.(qmd|md|ipynb|Rmd)$/, "") + ".html");
}

/** Slide map of a deck on disk, checked against its HTML when it exists. */
export async function deckSlideMap(
  dir: string,
  main: string,
): Promise<{ rows: SlideMapRow[]; html: HtmlAgreement; files: string[] }> {
  const { lines, files } = expandIncludes(dir, main);
  const rows = buildSlideMap(lines, main);
  const html = htmlFor(dir, main);
  const shownSlides = rows.filter((r) => r.shown !== null).length;
  const stat = await Deno.stat(html).catch(() => null);
  if (!stat) {
    return {
      rows,
      files,
      html: {
        html,
        exists: false,
        stale: false,
        htmlSlides: 0,
        shownSlides,
        agrees: false,
        mismatches: [],
      },
    };
  }
  let stale = false;
  for (const f of files) {
    const m = (await Deno.stat(join(dir, f)).catch(() => null))?.mtime;
    if (m && stat.mtime && m > stat.mtime) stale = true;
  }
  const cmp = compareWithHtml(
    rows,
    htmlSlideIds(await Deno.readTextFile(html)),
  );
  return { rows, files, html: { html, exists: true, stale, ...cmp } };
}

/** What `viewSlide` saw. */
export interface SlideView {
  png: Uint8Array;
  /** Slide counter text after navigating, e.g. "58 / 81" (empty if none). */
  counter: string;
  /** Section id of the slide Reveal landed on. */
  id: string;
  h: number;
  v: number;
  fragments: number;
  /** Fragment index shown (reveal's `f`), -1 = none. */
  fragment: number;
  overflowPx: number;
  overflowElement: string;
}

/**
 * Screenshot slide `shown` (1-based, as in the counter) of a built deck.
 * `fragment` = number of clicks into the slide (0 = before the first
 * fragment); omitted = all fragments visible.
 */
export async function viewSlide(opts: {
  html: string;
  shown: number;
  chrome?: string;
  width?: number;
  height?: number;
  scale?: number;
  fragment?: number;
}): Promise<SlideView> {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const page = await launchChrome(
    opts.chrome,
    { width, height },
    opts.scale ?? 2,
  );
  try {
    await page.goto("file://" + opts.html);
    await waitForReveal(page);
    await page.evaluate(
      "Reveal.configure({ transition: 'none', backgroundTransition: 'none', controls: false, progress: false })",
    );
    const f = opts.fragment === undefined ? 999 : opts.fragment - 1;
    const info = await page.evaluate<
      | { error: string }
      | {
        id: string;
        h: number;
        v: number;
        fragments: number;
        fragment: number;
        counter: string;
      }
    >(`(async () => {
      const all = Reveal.getSlides();
      const k = ${opts.shown - 1};
      if (k < 0 || k >= all.length) return { error: 'the built deck has ' + all.length + ' slides' };
      const s = all[k];
      const idx = Reveal.getIndices(s);
      Reveal.slide(idx.h, idx.v || 0, ${f});
      s.querySelectorAll('img[data-src]').forEach((im) => { im.src = im.dataset.src; });
      await Promise.all([...s.querySelectorAll('img')].map((im) =>
        im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 3000); })));
      await new Promise((r) => setTimeout(r, 500));
      const cur = Reveal.getIndices();
      const num = document.querySelector('.slide-number');
      return {
        id: Reveal.getCurrentSlide() === s ? s.id : 'navigation failed: at ' + Reveal.getCurrentSlide().id,
        h: idx.h, v: idx.v || 0,
        fragments: s.querySelectorAll('.fragment').length,
        fragment: typeof cur.f === 'number' ? cur.f : -1,
        counter: num ? num.textContent.replace(/\\s+/g, ' ').trim() : '',
      };
    })()`);
    if ("error" in info) throw new Error(info.error);
    const m = await page.evaluate<
      { overflowPx: number; overflowElement: string }
    >(
      MEASURE(width, height),
    );
    return { ...info, ...m, png: await page.screenshot("png") };
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------- method specs

const RowSchema = z.object({
  shown: z.number().nullable(),
  source: z.number(),
  title: z.string(),
  kind: z.string(),
  hidden: z.boolean(),
  file: z.string(),
  line: z.number(),
  section: z.string(),
  minutes: z.number().nullable(),
  id: z.string(),
});

const SlideMapSchema = z.object({
  main: z.string(),
  shownSlides: z.number(),
  hiddenSlides: z.number(),
  rows: z.array(RowSchema),
  html: z.object({
    html: z.string(),
    exists: z.boolean(),
    stale: z.boolean(),
    htmlSlides: z.number(),
    shownSlides: z.number(),
    agrees: z.boolean(),
    mismatches: z.array(
      z.object({ shown: z.number(), expected: z.string(), actual: z.string() }),
    ),
  }),
  mappedAt: z.string(),
});

const SlideViewInfoSchema = z.object({
  shown: z.number(),
  title: z.string(),
  file: z.string(),
  line: z.number(),
  kind: z.string(),
  png: z.string(),
  counter: z.string(),
  id: z.string(),
  fragment: z.number().nullable(),
  fragments: z.number(),
  overflowPx: z.number(),
  overflowElement: z.string(),
  overflows: z.boolean(),
  viewedAt: z.string(),
});

type Handle = { name: string };
interface Writer {
  writeAll(content: Uint8Array): Promise<Handle>;
  getFilePath?(): Promise<string>;
  finalize?(): Promise<Handle>;
}
/** The part of the method context these methods use. */
export interface SlideMapContext {
  globalArgs: { dir: string; main: string; chrome?: string };
  logger: { info: (msg: string, props?: Record<string, unknown>) => void };
  writeResource: (
    spec: string,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<Handle>;
  createFileWriter: (spec: string, name: string) => Writer;
}

/** Log lines about the HTML comparison; empty when it agrees. */
export function agreementNotes(h: HtmlAgreement): string[] {
  if (!h.exists) {
    return [`${h.html} not built yet; numbers come from the source only`];
  }
  const out: string[] = [];
  if (h.stale) {
    out.push(`${h.html} is older than the source; render to refresh`);
  }
  if (h.htmlSlides !== h.shownSlides) {
    out.push(
      `source gives ${h.shownSlides} shown slides, the HTML has ${h.htmlSlides}`,
    );
  }
  for (const m of h.mismatches.slice(0, 5)) {
    out.push(
      `slide ${m.shown}: source expects #${m.expected}, HTML has #${m.actual}`,
    );
  }
  if (h.mismatches.length > 5) out.push(`… ${h.mismatches.length - 5} more`);
  return out;
}

/** Resource specs to spread into the model's `resources`. */
export const slideMapResources = {
  slideMap: {
    description:
      "Every slide with the number shown in the slide counter, title, kind, file:line, section, minutes",
    schema: SlideMapSchema,
    lifetime: "infinite" as const,
    garbageCollection: 10,
  },
  slideViewInfo: {
    description: "One slide viewed: title, file:line, PNG path, overflow",
    schema: SlideViewInfoSchema,
    lifetime: "7d",
    garbageCollection: 20,
  },
};

/** File specs to spread into the model's `files`. */
export const slideMapFiles = {
  slideView: {
    description: "Screenshot of one slide of the built deck (PNG)",
    contentType: "image/png",
    lifetime: "7d",
    garbageCollection: 5,
  },
};

/** Methods to spread into the model's `methods`. */
export const slideMapMethods = {
  slide_map: {
    description:
      "List every slide with the number the audience sees in the slide counter (title slide = 1, hidden slides unnumbered), title, kind, file:line, section and minutes; confirmed against the built HTML",
    arguments: z.object({
      query: z.string().optional().describe(
        "Only print slides whose title contains this (case-insensitive)",
      ),
      around: z.number().int().optional().describe(
        "Only print shown slides n-3 … n+3",
      ),
    }),
    execute: async (
      args: { query?: string; around?: number },
      ctx: SlideMapContext,
    ): Promise<{ dataHandles: Handle[] }> => {
      const g = ctx.globalArgs;
      const { rows, html } = await deckSlideMap(g.dir, g.main);
      const shownSlides = rows.filter((r) => r.shown !== null).length;
      const hiddenSlides = rows.length - shownSlides;
      ctx.logger.info("{table}", {
        table: "\n" + formatSlideMap(selectRows(rows, args)),
      });
      ctx.logger.info(
        "{shown} shown slides (+{hidden} hidden); HTML {state}",
        {
          shown: shownSlides,
          hidden: hiddenSlides,
          state: !html.exists
            ? "not built"
            : html.agrees
            ? `agrees (${html.htmlSlides} slides${
              html.stale ? ", but stale" : ""
            })`
            : "DISAGREES",
        },
      );
      for (const note of agreementNotes(html)) {
        ctx.logger.info("{note}", { note });
      }
      const h = await ctx.writeResource("slideMap", "slide-map", {
        main: g.main,
        shownSlides,
        hiddenSlides,
        rows,
        html,
        mappedAt: new Date().toISOString(),
      });
      return { dataHandles: [h] };
    },
  },
  slide_view: {
    description:
      "Screenshot one slide of the built deck (1280x720 at scale 2, fragments shown) by its shown number or title; returns the PNG path, title, file:line and overflow",
    arguments: z.object({
      n: z.number().int().optional().describe(
        "Slide number as shown in the slide counter",
      ),
      title: z.string().optional().describe(
        "Substring of the slide title (first shown match)",
      ),
      fragment: z.number().int().min(0).optional().describe(
        "Show the slide after this many clicks (0 = no fragments); default all shown",
      ),
      scale: z.number().positive().default(2),
      width: z.number().default(1280),
      height: z.number().default(720),
    }),
    execute: async (
      args: {
        n?: number;
        title?: string;
        fragment?: number;
        scale: number;
        width: number;
        height: number;
      },
      ctx: SlideMapContext,
    ): Promise<{ dataHandles: Handle[] }> => {
      const g = ctx.globalArgs;
      const { rows, html } = await deckSlideMap(g.dir, g.main);
      if (!html.exists) {
        throw new Error(`${html.html} not found — run render first`);
      }
      const { row, others } = findSlide(rows, args);
      for (const o of others) {
        ctx.logger.info('also matches: {n} "{t}"', { n: o.shown, t: o.title });
      }
      for (const note of agreementNotes(html)) {
        ctx.logger.info("{note}", { note });
      }
      const view = await viewSlide({
        html: html.html,
        shown: row.shown!,
        chrome: g.chrome ?? MAC_CHROME,
        width: args.width,
        height: args.height,
        scale: args.scale,
        fragment: args.fragment,
      });
      if (view.id !== row.id) {
        ctx.logger.info(
          "warning: source expects #{want} at slide {n}, Chrome shows #{got}",
          { want: row.id, n: row.shown, got: view.id },
        );
      }
      const w = ctx.createFileWriter("slideView", `slide-${row.shown}`);
      let png = "";
      let fileHandle: Handle;
      if (w.getFilePath && w.finalize) {
        png = await w.getFilePath();
        await Deno.writeFile(png, view.png);
        fileHandle = await w.finalize();
      } else {
        fileHandle = await w.writeAll(view.png);
      }
      const overflows = view.overflowPx > 2;
      ctx.logger.info(
        'slide {n} "{t}" ({file}:{line}){over}; png {png}',
        {
          n: row.shown,
          t: row.title,
          file: row.file,
          line: row.line,
          over: overflows
            ? ` overflows by ${view.overflowPx}px <- ${view.overflowElement}`
            : ", no overflow",
          png,
        },
      );
      const info = await ctx.writeResource("slideViewInfo", "slide-view", {
        shown: row.shown,
        title: row.title,
        file: row.file,
        line: row.line,
        kind: row.kind,
        png,
        counter: view.counter,
        id: view.id,
        fragment: args.fragment ?? null,
        fragments: view.fragments,
        overflowPx: view.overflowPx,
        overflowElement: view.overflowElement,
        overflows,
        viewedAt: new Date().toISOString(),
      });
      return { dataHandles: [info, fileHandle] };
    },
  },
};
