/**
 * Hand-out PDF of a rendered reveal.js deck, built from screenshots.
 *
 * Chrome's `?print-pdf` mode lets tall slides spill over several pages, URL
 * navigation (`#/k`) does not always land on slide k, and a slide count taken
 * from the source is wrong as soon as a slide is hidden (hidden slides are
 * removed from the built HTML). So: open the deck once in headless Chrome,
 * force every fragment visible, walk the live `Reveal.getSlides()` with the
 * Reveal API, screenshot each slide, and print an HTML page of those images
 * with one 1280×720 page per image. The page count is checked against the
 * live slide count.
 * @module
 */
import { z } from "npm:zod@4";
import { type ChromePage, launchChrome, waitForReveal } from "./chrome.ts";
import { contactSheets } from "./check.ts";
import { pdfPages } from "./pdf.ts";

/** How to cut the deck into parts. */
export type SplitSpec =
  | { mode: "none" }
  | { mode: "sections" }
  | { mode: "pages"; starts: number[] };

/**
 * Parse the `split` input: a list of 1-based start pages, `"sections"`,
 * `"at:<n>"` / `"at:<n>,<m>"`, or a bare `"30,60"`. Empty means one PDF.
 */
export function parseSplit(split: string | number[] | undefined): SplitSpec {
  if (split === undefined) return { mode: "none" };
  if (Array.isArray(split)) {
    return { mode: "pages", starts: checkStarts(split) };
  }
  const s = split.trim();
  if (!s || s === "none") return { mode: "none" };
  if (s === "sections") return { mode: "sections" };
  const body = s.startsWith("at:") ? s.slice(3) : s.replace(/^\[|\]$/g, "");
  const nums = body.split(",").map((x) => x.trim()).filter(Boolean);
  if (!nums.length || nums.some((x) => !/^\d+$/.test(x))) {
    throw new Error(
      `split "${split}": expected "sections", "at:<n>" or a list of 1-based start pages`,
    );
  }
  return { mode: "pages", starts: checkStarts(nums.map(Number)) };
}

function checkStarts(xs: number[]): number[] {
  for (const x of xs) {
    if (!Number.isInteger(x) || x < 1) {
      throw new Error(`split: start page ${x} is not a positive integer`);
    }
  }
  return xs;
}

/** One part of the hand-out: slides `from`..`to`, 1-based, inclusive. */
export interface PartPlan {
  part: number;
  from: number;
  to: number;
}

/**
 * Cut `n` slides into parts starting at `starts` (1-based). Page 1 always
 * starts a part; duplicates are dropped; a start beyond `n` is an error.
 */
export function planParts(n: number, starts: number[]): PartPlan[] {
  if (n < 1) throw new Error("deck has no slides");
  for (const s of starts) {
    if (s > n) {
      throw new Error(`split: start page ${s} is beyond the last slide (${n})`);
    }
  }
  const cuts = [...new Set([1, ...starts])].sort((a, b) => a - b);
  return cuts.map((from, i) => ({
    part: i + 1,
    from,
    to: i + 1 < cuts.length ? cuts[i + 1] - 1 : n,
  }));
}

/**
 * Start pages for `split=sections`: every `#` section divider, except one on
 * page 2 (that would leave the title slide alone in part 1).
 */
export function sectionStarts(dividers: number[]): number[] {
  return dividers.filter((p) => p > 2);
}

/** Validate a file-name suffix such as `18nov2026`. */
export function checkSuffix(suffix: string | undefined): string | undefined {
  if (suffix === undefined || suffix === "") return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(suffix)) {
    throw new Error(
      `suffix "${suffix}": use letters, digits, '.', '_' or '-' only`,
    );
  }
  return suffix;
}

/** `glycolysis.pdf`, `glycolysis_18nov2026.pdf`, `glycolysis_part1_18nov2026.pdf`. */
export function partFileName(
  base: string,
  part: number,
  parts: number,
  suffix?: string,
  ext = "pdf",
): string {
  return [base, parts > 1 ? `part${part}` : "", suffix ?? ""]
    .filter(Boolean).join("_") + "." + ext;
}

/** HTML page that prints one `width`×`height` page per image. */
export function pagesHtml(
  images: string[],
  width: number,
  height: number,
): string {
  const esc = (s: string) =>
    s.replace(/[<&>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><meta charset="utf-8"><style>
@page{size:${width}px ${height}px;margin:0}
html,body{margin:0;padding:0;background:#fff}
.page{width:${width}px;height:${height}px;overflow:hidden;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.page img{display:block;width:${width}px;height:${height}px}
</style>${
    images.map((src) => `<div class="page"><img src="${esc(src)}"></div>`)
      .join("")
  }`;
}

/** Page count of a PDF by counting page objects (fallback when `pdfinfo` is missing). */
export function countPdfPages(bytes: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(bytes);
  return (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
}

/** Pages (1-based) whose screenshot is byte-identical to the previous one. */
export function repeatedPages(hashes: string[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < hashes.length; i++) {
    if (hashes[i] === hashes[i - 1]) out.push(i + 1);
  }
  return out;
}

/** Verification of exported parts against the live slide count. */
export function verifyParts(
  liveSlides: number,
  parts: Array<PartPlan & { pages: number | null }>,
): string[] {
  const errors: string[] = [];
  let total = 0;
  for (const p of parts) {
    const want = p.to - p.from + 1;
    if (p.pages === null) {
      errors.push(`part ${p.part}: page count unknown`);
      continue;
    }
    if (p.pages !== want) {
      errors.push(
        `part ${p.part}: ${p.pages} pages, expected ${want} (slides ${p.from}-${p.to})`,
      );
    }
    total += p.pages;
  }
  if (total !== liveSlides) {
    errors.push(
      `${total} pages in total, but the deck has ${liveSlides} slides`,
    );
  }
  return errors;
}

/**
 * CSS for the capture: every fragment shown, no controls, progress bar or
 * menu button, no transitions. Notes stay hidden (reveal hides `aside.notes`).
 */
export const CAPTURE_CSS = `
.reveal .slides section .fragment, .reveal .slides section .fragment.fade-out,
.reveal .slides section .fragment.semi-fade-out {
  opacity: 1 !important; visibility: visible !important; transform: none !important;
  filter: none !important; transition: none !important; }
.reveal .controls, .reveal .progress, .slide-menu-button, .reveal .slide-menu-button,
.slide-chalkboard-buttons, .reveal .slide-chalkboard-buttons { display: none !important; }
.reveal .slides section, .reveal .slide-background, .reveal .slides * {
  transition: none !important; transition-duration: 0s !important; }
aside.notes { display: none !important; }
`;

/** Stored as the `pdf-info` resource. `path`/`pages`/`bytes` summarise all parts. */
export const ExportPdfInfoSchema = z.object({
  path: z.string(),
  pages: z.number().nullable(),
  bytes: z.number(),
  html: z.string().optional(),
  liveSlides: z.number().optional(),
  split: z.string().optional(),
  scale: z.number().optional(),
  format: z.string().optional(),
  parts: z.array(z.object({
    part: z.number(),
    from: z.number(),
    to: z.number(),
    path: z.string(),
    pages: z.number().nullable(),
    bytes: z.number(),
    firstTitle: z.string(),
    lastTitle: z.string(),
    sheet: z.string().nullable(),
  })).optional(),
  verification: z.object({
    ok: z.boolean(),
    pagesTotal: z.number(),
    liveSlides: z.number(),
    errors: z.array(z.string()),
    repeatedPages: z.array(z.number()),
  }).optional(),
  exportedAt: z.string(),
});

/** What one slide looked like in the browser. */
export interface ShotInfo {
  n: number;
  h: number;
  v: number;
  title: string;
  /** A `#` section divider (Quarto gives it class `level1`). */
  section: boolean;
}

/** Go to slide `i` (0-based in the live `Reveal.getSlides()`) via the Reveal API. */
async function gotoSlide(page: ChromePage, i: number): Promise<ShotInfo> {
  const r = await page.evaluate<
    | (Omit<ShotInfo, "n"> & { ok: true })
    | { ok: false; why: string }
  >(`(async () => {
    const s = Reveal.getSlides()[${i}];
    if (!s) return { ok: false, why: 'no slide at index ${i}' };
    const idx = Reveal.getIndices(s);
    Reveal.slide(idx.h, idx.v);
    s.querySelectorAll('img[data-src], video[data-src], iframe[data-src], source[data-src]')
      .forEach((el) => { if (!el.getAttribute('src')) el.setAttribute('src', el.dataset.src); });
    await Promise.all([...s.querySelectorAll('img')].map((im) =>
      im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 5000); })));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 250));
    if (Reveal.getCurrentSlide() !== s) {
      const c = Reveal.getIndices();
      return { ok: false, why: 'Reveal.slide(' + idx.h + ',' + (idx.v || 0) + ') landed on ' + c.h + '/' + (c.v || 0) };
    }
    const shown = s.cloneNode(true);
    shown.querySelectorAll('aside.notes, script, style, section').forEach((el) => el.remove());
    const t = shown.querySelector('h1, h2, h3');
    const title = ((t && t.textContent.trim()) ? t.textContent : shown.textContent)
      .replace(/\\s+/g, ' ').trim().slice(0, 100);
    return { ok: true, h: idx.h, v: idx.v || 0, title, section: s.classList.contains('level1') };
  })()`);
  if (!r.ok) throw new Error(`slide ${i + 1}: ${r.why}`);
  const { ok: _ok, ...info } = r;
  return { n: i + 1, ...info };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes as BufferSource),
  );
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Print the current page to PDF, streamed (large image PDFs exceed one message). */
async function printToPdf(
  page: ChromePage,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const r = await page.send("Page.printToPDF", {
    printBackground: true,
    preferCSSPageSize: true,
    paperWidth: width / 96,
    paperHeight: height / 96,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    transferMode: "ReturnAsStream",
  }) as { stream?: string; data?: string };
  const chunks: Uint8Array[] = [];
  const decode = (b64: string) =>
    Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (!r.stream) return decode(r.data ?? "");
  for (;;) {
    const c = await page.send("IO.read", {
      handle: r.stream,
      size: 4 << 20,
    }) as {
      data: string;
      base64Encoded?: boolean;
      eof: boolean;
    };
    if (c.data) {
      chunks.push(
        c.base64Encoded ? decode(c.data) : new TextEncoder().encode(c.data),
      );
    }
    if (c.eof) break;
  }
  await page.send("IO.close", { handle: r.stream }).catch(() => {});
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** One exported PDF. */
export interface ExportedPart extends PartPlan {
  path: string;
  pages: number | null;
  bytes: number;
  firstTitle: string;
  lastTitle: string;
  sheet: string | null;
}

/** Result of `exportDeckPdf`. */
export interface DeckExport {
  html: string;
  liveSlides: number;
  split: string;
  scale: number;
  format: "png" | "jpeg";
  parts: ExportedPart[];
  verification: {
    ok: boolean;
    pagesTotal: number;
    liveSlides: number;
    errors: string[];
    /** Pages identical to the one before (a sign navigation did not move). */
    repeatedPages: number[];
  };
  slides: ShotInfo[];
}

/**
 * Screenshot every slide of a built deck and assemble one PDF per part.
 * Throws when the page count disagrees with the live slide count.
 */
export async function exportDeckPdf(opts: {
  html: string;
  outDir: string;
  base: string;
  split?: string | number[];
  suffix?: string;
  scale?: number;
  chrome?: string;
  width?: number;
  height?: number;
  format?: "png" | "jpeg";
  quality?: number;
  sheets?: boolean;
  log?: (msg: string, props?: Record<string, unknown>) => void;
}): Promise<DeckExport> {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const scale = opts.scale ?? 2;
  const format = opts.format ?? "png";
  const suffix = checkSuffix(opts.suffix);
  const spec = parseSplit(opts.split);
  const log = opts.log ?? (() => {});
  const tmp = await Deno.makeTempDir({ prefix: "quarto-deck-export-" });
  const page = await launchChrome(opts.chrome, { width, height }, scale);
  const shots: Uint8Array[] = [];
  const slides: ShotInfo[] = [];
  const hashes: string[] = [];
  const parts: ExportedPart[] = [];
  try {
    await page.goto("file://" + opts.html);
    await waitForReveal(page);
    await page.evaluate(`(() => {
      Reveal.configure({ transition: 'none', backgroundTransition: 'none',
        controls: false, progress: false });
      const st = document.createElement('style');
      st.id = 'quarto-deck-export';
      st.textContent = ${JSON.stringify(CAPTURE_CSS)};
      document.head.appendChild(st);
      return true;
    })()`);
    const n = await page.evaluate<number>("Reveal.getSlides().length");
    log("Capturing {n} slides at {w}x{h} x{s}", {
      n,
      w: width,
      h: height,
      s: scale,
    });
    const ext = format === "jpeg" ? "jpg" : "png";
    for (let i = 0; i < n; i++) {
      const info = await gotoSlide(page, i);
      const img = await page.screenshot(format, opts.quality ?? 90);
      slides.push(info);
      shots.push(img);
      hashes.push(await sha256(img));
      await Deno.writeFile(
        `${tmp}/p${String(i + 1).padStart(4, "0")}.${ext}`,
        img,
      );
    }
    const n2 = await page.evaluate<number>("Reveal.getSlides().length");
    if (n2 !== n) {
      throw new Error(`slide count changed during capture: ${n} -> ${n2}`);
    }

    const starts = spec.mode === "pages"
      ? spec.starts
      : spec.mode === "sections"
      ? sectionStarts(slides.filter((s) => s.section).map((s) => s.n))
      : [];
    const plan = planParts(n, starts);
    await Deno.mkdir(opts.outDir, { recursive: true });
    for (const p of plan) {
      const imgs = [];
      for (let k = p.from; k <= p.to; k++) {
        imgs.push(`p${String(k).padStart(4, "0")}.${ext}`);
      }
      const htmlFile = `${tmp}/part${p.part}.html`;
      await Deno.writeTextFile(htmlFile, pagesHtml(imgs, width, height));
      await page.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await page.goto("file://" + htmlFile);
      await page.evaluate(`Promise.all([...document.images].map((im) =>
        im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })))`);
      const pdf = await printToPdf(page, width, height);
      const path = `${opts.outDir.replace(/\/$/, "")}/${
        partFileName(opts.base, p.part, plan.length, suffix)
      }`;
      await Deno.writeFile(path, pdf);
      const pages = (await pdfPages(path)) ?? countPdfPages(pdf);
      parts.push({
        ...p,
        path,
        pages,
        bytes: pdf.length,
        firstTitle: slides[p.from - 1].title,
        lastTitle: slides[p.to - 1].title,
        sheet: null,
      });
      log("{path}: {p} pages (slides {f}-{t}), {mb} MB", {
        path,
        p: pages,
        f: p.from,
        t: p.to,
        mb: (pdf.length / 1e6).toFixed(1),
      });
    }
  } finally {
    await page.close();
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }

  const n = slides.length;
  const errors = verifyParts(n, parts);
  if (errors.length) {
    throw new Error(`PDF verification failed: ${errors.join("; ")}`);
  }
  // Contact sheets need a grid-sized browser of their own (one per call, not per slide).
  if (opts.sheets !== false) {
    await sheetsFor(parts, shots, slides, opts.chrome).catch((e) =>
      log("contact sheet failed: {e}", { e: String(e) })
    );
  }
  return {
    html: opts.html,
    liveSlides: n,
    split: spec.mode === "pages"
      ? `pages:${parts.map((p) => p.from).join(",")}`
      : spec.mode,
    scale,
    format,
    parts,
    verification: {
      ok: true,
      pagesTotal: parts.reduce((a, p) => a + (p.pages ?? 0), 0),
      liveSlides: n,
      errors,
      repeatedPages: repeatedPages(hashes),
    },
    slides,
  };
}

/** One contact sheet PNG per part, next to the part's PDF. */
async function sheetsFor(
  parts: ExportedPart[],
  shots: Uint8Array[],
  slides: ShotInfo[],
  chrome?: string,
): Promise<void> {
  for (const p of parts) {
    const k = p.to - p.from + 1;
    const cols = Math.min(6, k);
    const [png] = await contactSheets(
      shots.slice(p.from - 1, p.to),
      slides.slice(p.from - 1, p.to).map((s) => s.title),
      {
        chrome,
        cols,
        rows: Math.ceil(k / cols),
        numbers: slides.slice(p.from - 1, p.to).map((s) => s.n),
      },
    );
    const sheet = p.path.replace(/\.pdf$/, "_sheet.png");
    await Deno.writeFile(sheet, png);
    p.sheet = sheet;
  }
}
