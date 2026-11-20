/**
 * Figures without guessing: place a crop box on a PDF page from the words on
 * it (panel labels, caption start), preview the box before cropping, find a
 * paper in the local papers folder by DOI or key and register it on first use,
 * crop images that are not PDFs (screenshots, publisher figures) with
 * provenance, and check the numbers on a slide against the cited paper.
 *
 * Pure helpers are exported for tests; the method bodies at the end take a
 * minimal context so `quarto_deck.ts` only registers them.
 * Uses poppler (`pdftotext -bbox-layout`, `pdftoppm`) and `ffmpeg` (images).
 * @module
 */
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
  sha256File,
  slug,
  type SourceRecord,
  trimmedBox,
} from "./sources.ts";

/** Box in PDF points (or pixels for images), origin top-left. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Words on a page (pdftotext -bbox-layout)

/** One word with its bounding box in points and its line/block ids. */
export interface WordBox {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  line: number;
  block: number;
}

/** Words and blocks of one page. */
export interface PageLayout {
  width: number;
  height: number;
  words: WordBox[];
  blocks: Array<{ xMin: number; yMin: number; xMax: number; yMax: number }>;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, n) => String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function attrs(s: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of s.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = Number(m[2]);
  return out;
}

/** Parse the XHTML of `pdftotext -bbox-layout` into pages of words. */
export function parseBboxLayout(xhtml: string): PageLayout[] {
  const pages: PageLayout[] = [];
  let line = -1, block = -1;
  for (
    const m of xhtml.matchAll(
      /<(page|block|line|word)\b([^>]*)>(?:([^<]*)<\/word>)?/g,
    )
  ) {
    const a = attrs(m[2]);
    if (m[1] === "page") {
      pages.push({ width: a.width, height: a.height, words: [], blocks: [] });
      continue;
    }
    const p = pages[pages.length - 1];
    if (!p) continue;
    if (m[1] === "block") {
      p.blocks.push({ xMin: a.xMin, yMin: a.yMin, xMax: a.xMax, yMax: a.yMax });
      block = p.blocks.length - 1;
    } else if (m[1] === "line") {
      line++;
    } else {
      p.words.push({
        text: decodeEntities(m[3] ?? ""),
        xMin: a.xMin,
        yMin: a.yMin,
        xMax: a.xMax,
        yMax: a.yMax,
        line,
        block,
      });
    }
  }
  return pages;
}

/** A word or phrase found on the page, with the union of its boxes. */
export interface WordMatch {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  block: number;
}

const stripPunct = (s: string) => s.replace(/^[(\[]+|[).,:;|\]]+$/g, "");

/**
 * Find a word, a phrase (consecutive words on one line, e.g. "Figure 3") or a
 * `/regex/flags` (tested against single words) on the page.
 */
export function findWords(page: PageLayout, spec: string): WordMatch[] {
  const out: WordMatch[] = [];
  const re = spec.match(/^\/(.+)\/([a-z]*)$/);
  const ws = page.words;
  if (re) {
    const r = new RegExp(re[1], re[2]);
    for (const w of ws) if (r.test(w.text)) out.push({ ...w });
    return out;
  }
  const toks = spec.trim().split(/\s+/);
  for (let i = 0; i + toks.length <= ws.length; i++) {
    let ok = true;
    for (let k = 0; k < toks.length && ok; k++) {
      const w = ws[i + k];
      ok = w.line === ws[i].line &&
        (w.text === toks[k] || stripPunct(w.text) === stripPunct(toks[k]));
    }
    if (!ok) continue;
    const span = ws.slice(i, i + toks.length);
    out.push({
      text: span.map((w) => w.text).join(" "),
      xMin: Math.min(...span.map((w) => w.xMin)),
      yMin: Math.min(...span.map((w) => w.yMin)),
      xMax: Math.max(...span.map((w) => w.xMax)),
      yMax: Math.max(...span.map((w) => w.yMax)),
      block: ws[i].block,
    });
  }
  return out;
}

/** Where a crop starts and ends, in words on the page. */
export interface AnchorSpec {
  /** Word at the top-left of the figure, usually the panel label ("c"). */
  from: string;
  /** Word just below the figure, usually the caption start ("Figure 3"). */
  to?: string;
  /** Word at the left edge (kept), when the figure starts left of `from`. */
  left?: string;
  /** Word at the right edge (kept). */
  right?: string;
  /** Pick the `from` match nearest this point (points) when it occurs more than once. */
  near?: { x: number; y: number };
  /** Margin in points around the anchors (default 4). */
  pad?: number;
  /** Width in points instead of a right anchor. */
  w?: number;
  /** Height in points instead of a `to` anchor. */
  h?: number;
  /**
   * "one" (default): when `from` is a panel label, the box stops at the next
   * panel label below and to the right — one panel. "all": panel labels are
   * ignored, so the box runs down to `to` (e.g. the caption) and across to the
   * `to` block's right edge — several panels together (Fig. 1a-b).
   */
  panels?: "one" | "all";
}

/** A box resolved from anchors, with what decided each edge. */
export interface ResolvedAnchor {
  box: Box;
  from: WordMatch;
  to: WordMatch | null;
  edges: { left: string; top: string; right: string; bottom: string };
}

const PANEL_LABEL = /^\(?[A-Za-z]\)?$/;
const where = (m: WordMatch) =>
  `"${m.text}" at x=${m.xMin.toFixed(1)} y=${m.yMin.toFixed(1)}`;
const dist = (m: WordMatch, p: { x: number; y: number }) =>
  Math.hypot(m.xMin - p.x, m.yMin - p.y);

/**
 * Resolve anchors to a crop box in points. Edges:
 * top = `from` top; left = `left` word or `from` left; bottom = the nearest
 * `to` match below whose text block reaches over the left edge, else `h`, else
 * the next panel label below in the same column, else the page; right =
 * `right` word, else `w`, else the next panel label on the same row (when
 * `from` is a panel label), else the right edge of the `to` block, else the
 * text column edge. All minus/plus `pad`. Throws when `from` is ambiguous and
 * no `near` is given, listing the candidates.
 */
export function resolveAnchor(
  page: PageLayout,
  a: AnchorSpec,
): ResolvedAnchor {
  const pad = a.pad ?? 4;
  const cands = findWords(page, a.from);
  if (!cands.length) throw new Error(`anchor from "${a.from}" not on the page`);
  let from: WordMatch;
  if (a.near) {
    from = cands.reduce((b, c) => dist(c, a.near!) < dist(b, a.near!) ? c : b);
  } else if (cands.length > 1) {
    throw new Error(
      `anchor from "${a.from}" occurs ${cands.length} times; add near={"x":..,"y":..}: ` +
        cands.slice(0, 10).map(where).join("; "),
    );
  } else from = cands[0];

  const fromPt = { x: from.xMin, y: from.yMin };
  const edges = { left: "", top: "", right: "", bottom: "" };
  let top = from.yMin - pad;
  edges.top = `from ${where(from)}`;

  let left = from.xMin - pad;
  edges.left = `from ${where(from)}`;
  if (a.left) {
    const l = findWords(page, a.left).filter((c) => c.xMin <= from.xMax);
    if (!l.length) {
      throw new Error(`anchor left "${a.left}" not found left of from`);
    }
    const best = l.reduce((b, c) => dist(c, fromPt) < dist(b, fromPt) ? c : b);
    left = best.xMin - pad;
    edges.left = `left ${where(best)}`;
  }

  const isLabel = PANEL_LABEL.test(from.text) && a.panels !== "all";
  const labels = isLabel
    ? page.words.filter((w) => PANEL_LABEL.test(w.text))
    : [];

  // bottom
  let to: WordMatch | null = null;
  let below: WordMatch | null = null;
  let bottom = Infinity;
  if (a.to) {
    const below = findWords(page, a.to).filter((c) => {
      if (c.yMin < from.yMax - 0.5) return false;
      const b = page.blocks[c.block];
      const x0 = Math.min(c.xMin, b?.xMin ?? c.xMin);
      const x1 = Math.max(c.xMax, b?.xMax ?? c.xMax);
      return x0 <= left + pad + 1 + 30 && x1 > left + pad + 1;
    });
    if (!below.length) {
      throw new Error(`anchor to "${a.to}" not found below ${where(from)}`);
    }
    to = below.reduce((b, c) => c.yMin < b.yMin ? c : b);
    bottom = to.yMin - pad;
    edges.bottom = `to ${where(to)}`;
  } else if (a.h) {
    bottom = top + a.h;
    edges.bottom = `h=${a.h}`;
  }
  if (isLabel) {
    const under = labels.filter((w) =>
      w.yMin > from.yMax + 10 && Math.abs(w.xMin - from.xMin) < 15 &&
      w.yMin - pad < bottom
    );
    if (under.length) {
      const n = under.reduce((b, c) => c.yMin < b.yMin ? c : b);
      below = n;
      bottom = n.yMin - pad;
      edges.bottom = `next panel label below ${where(n)}`;
    }
  }
  if (!Number.isFinite(bottom)) {
    bottom = Math.max(...page.words.map((w) => w.yMax)) + pad;
    edges.bottom = "page text bottom";
  }

  // right
  let right: number;
  if (a.right) {
    const r = findWords(page, a.right).filter((c) => c.xMax >= from.xMin);
    if (!r.length) {
      throw new Error(`anchor right "${a.right}" not found right of from`);
    }
    const best = r.reduce((b, c) => dist(c, fromPt) < dist(b, fromPt) ? c : b);
    right = best.xMax + pad;
    edges.right = `right ${where(best)}`;
  } else if (a.w) {
    right = left + a.w;
    edges.right = `w=${a.w}`;
  } else {
    const beside = labels.filter((w) =>
      Math.abs(w.yMin - from.yMin) < 4 && w.xMin > from.xMax + 10
    );
    if (beside.length) {
      const n = beside.reduce((b, c) => c.xMin < b.xMin ? c : b);
      right = n.xMin - pad;
      edges.right = `next panel label ${where(n)}`;
    } else if (to && page.blocks[to.block]) {
      right = page.blocks[to.block].xMax + pad;
      edges.right = `right edge of the "${to.text}" text block`;
      if (/^table/i.test(from.text) || /^table/i.test(to.text)) {
        edges.right +=
          " — a table is often wider than that block: check the preview and give right= or w=";
      }
    } else {
      right = Math.max(...page.words.map((w) => w.xMax)) + pad;
      edges.right = "text column edge";
    }
  }
  // the pad must not reach into text above the figure (an axis label of the
  // panel above often ends level with the top of the panel label)
  const above = page.words.filter((w) =>
    w.yMin < from.yMin - 0.5 && w.yMax > top && w.xMax > left &&
    w.xMin < right
  );
  if (above.length) {
    const n = above.reduce((b, c) => c.yMax > b.yMax ? c : b);
    top = Math.min(from.yMin, n.yMax + 0.3);
    edges.top += `, kept below "${n.text}" (yMax ${n.yMax.toFixed(1)})`;
  }
  // nor cut off text of this panel that sits level with the next panel label
  // (an x-axis title often ends below the top of the label under it)
  if (below) {
    const nb = below;
    const cut = page.words.filter((w) =>
      w.yMin > from.yMax && w.yMin < nb.yMin - 0.1 && w.yMax > bottom &&
      w.xMax > left && w.xMin < right && w !== nb
    );
    if (cut.length) {
      const n = cut.reduce((b, c) => c.yMax > b.yMax ? c : b);
      bottom = Math.min(nb.yMax, n.yMax + 0.3);
      edges.bottom += `, kept "${n.text}" (yMax ${n.yMax.toFixed(1)})`;
    }
  }
  const box = boxToPoints(
    {
      x: left,
      y: top,
      w: Math.max(1, right - left),
      h: Math.max(1, bottom - top),
    },
    page,
  );
  return { box, from, to, edges };
}

// ---------------------------------------------------------------------------
// Drawing and PNG encoding (pure TS)

/** An RGB image (3 bytes per pixel). */
export interface Rgb {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Draw a rectangle outline (pixels, inclusive of x/y, `t` px thick). */
export function drawRect(
  img: Rgb,
  r: { x: number; y: number; W: number; H: number },
  color: [number, number, number],
  t = 3,
): void {
  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const k = (y * img.width + x) * 3;
    img.data[k] = color[0];
    img.data[k + 1] = color[1];
    img.data[k + 2] = color[2];
  };
  const x0 = r.x, y0 = r.y, x1 = r.x + r.W - 1, y1 = r.y + r.H - 1;
  for (let i = 0; i < t; i++) {
    for (let x = x0 - i; x <= x1 + i; x++) {
      set(x, y0 - i);
      set(x, y1 + i);
    }
    for (let y = y0 - i; y <= y1 + i; y++) {
      set(x0 - i, y);
      set(x1 + i, y);
    }
  }
}

/** 3x5 bitmaps of the digits 0-9 (rows top to bottom, 3 bits each). */
const DIGITS = [
  [7, 5, 5, 5, 7],
  [2, 6, 2, 2, 7],
  [7, 1, 7, 4, 7],
  [7, 1, 7, 1, 7],
  [5, 5, 7, 1, 1],
  [7, 4, 7, 1, 7],
  [7, 4, 7, 5, 7],
  [7, 1, 2, 2, 2],
  [7, 5, 7, 5, 7],
  [7, 5, 7, 1, 7],
];

/** Write a number with the 3x5 digit font, `scale` px per dot, on white. */
function drawNumber(
  img: Rgb,
  n: number,
  x: number,
  y: number,
  scale: number,
  color: [number, number, number],
): void {
  const text = String(n);
  const w = text.length * 4 * scale, h = 6 * scale;
  for (let yy = y - scale; yy < y + h; yy++) {
    for (let xx = x - scale; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
      img.data.fill(
        255,
        (yy * img.width + xx) * 3,
        (yy * img.width + xx) * 3 + 3,
      );
    }
  }
  [...text].forEach((c, k) => {
    const g = DIGITS[Number(c)];
    for (let r = 0; r < 5; r++) {
      for (let col = 0; col < 3; col++) {
        if (!(g[r] & (4 >> col))) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = x + (k * 4 + col) * scale + dx, py = y + r * scale + dy;
            if (px < 0 || py < 0 || px >= img.width || py >= img.height) {
              continue;
            }
            const i = (py * img.width + px) * 3;
            img.data[i] = color[0];
            img.data[i + 1] = color[1];
            img.data[i + 2] = color[2];
          }
        }
      }
    }
  });
}

/**
 * Coordinate grid in PDF points on a page rendered at `dpi`: a light line
 * every `stepPt`, a darker one every 2×`stepPt`, labelled with its value in
 * points along the top and left edges. Lines are blended so text stays
 * readable.
 */
export function drawGrid(img: Rgb, dpi: number, stepPt = 50): void {
  const s = dpi / 72;
  const blend = (i: number, c: [number, number, number], a: number) => {
    for (let k = 0; k < 3; k++) {
      img.data[i + k] = Math.round(img.data[i + k] * (1 - a) + c[k] * a);
    }
  };
  for (
    let pt = stepPt;
    pt * s < Math.max(img.width, img.height);
    pt += stepPt
  ) {
    const major = pt % (2 * stepPt) === 0;
    const c: [number, number, number] = major ? [0, 120, 200] : [0, 160, 220];
    const a = major ? 0.55 : 0.25;
    const p = Math.round(pt * s);
    if (p < img.width) {
      for (let y = 0; y < img.height; y++) blend((y * img.width + p) * 3, c, a);
    }
    if (p < img.height) {
      for (let x = 0; x < img.width; x++) blend((p * img.width + x) * 3, c, a);
    }
    if (major) {
      const sc = Math.max(1, Math.round(s * 1.5));
      if (p < img.width) drawNumber(img, pt, p + 2, 2, sc, [0, 90, 160]);
      if (p < img.height) drawNumber(img, pt, 2, p + 2, sc, [0, 90, 160]);
    }
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 as used by PNG. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data as BlobPart]).stream().pipeThrough(
    new CompressionStream("deflate"),
  );
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Encode an RGB image as an 8-bit truecolour PNG. */
export async function encodePng(img: Rgb): Promise<Uint8Array> {
  const row = img.width * 3;
  const raw = new Uint8Array((row + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (row + 1)] = 0; // filter: none
    raw.set(img.data.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  }
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    const tb = new TextEncoder().encode(type);
    out.set(tb, 4);
    out.set(body, 8);
    dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, img.width);
  dv.setUint32(4, img.height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", await zlib(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Image files (screenshots, publisher figures)

/** Width and height of a PNG or JPEG from its header; null when unknown. */
export function imageSize(
  bytes: Uint8Array,
): { width: number; height: number; format: "png" | "jpeg" } | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { ...pngSize(bytes), format: "png" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (
        marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)
      ) {
        i += 2;
        continue;
      }
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      // SOF0..SOF15 except DHT (c4), JPG (c8), DAC (cc)
      if (
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 &&
        marker !== 0xc8 && marker !== 0xcc
      ) {
        return {
          height: (bytes[i + 5] << 8) | bytes[i + 6],
          width: (bytes[i + 7] << 8) | bytes[i + 8],
          format: "jpeg",
        };
      }
      i += 2 + len;
    }
  }
  return null;
}

/**
 * EXIF orientation (1-8) of a JPEG from its APP1 segment; 1 when there is
 * none. 5-8 mean the stored pixels are turned a quarter: width and height
 * swap when the photo is shown upright.
 */
export function exifOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xda || marker === 0xd9) break; // image data starts
    const ascii = String.fromCharCode(...bytes.subarray(i + 4, i + 10));
    if (marker === 0xe1 && ascii === "Exif\0\0") {
      const t = i + 10; // TIFF header
      const le = bytes[t] === 0x49 && bytes[t + 1] === 0x49;
      const u16 = (o: number) =>
        le
          ? bytes[t + o] | (bytes[t + o + 1] << 8)
          : (bytes[t + o] << 8) | bytes[t + o + 1];
      const u32 = (o: number) =>
        le
          ? (bytes[t + o] | (bytes[t + o + 1] << 8) | (bytes[t + o + 2] << 16) |
            (bytes[t + o + 3] << 24)) >>> 0
          : ((bytes[t + o] << 24) | (bytes[t + o + 1] << 16) |
            (bytes[t + o + 2] << 8) | bytes[t + o + 3]) >>> 0;
      const ifd = u32(4);
      if (t + ifd + 2 > bytes.length) return 1;
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + 12 * k;
        if (t + e + 12 > bytes.length) break;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

/** ffmpeg filter that turns stored pixels upright for an EXIF orientation. */
export function orientFilter(orientation: number): string | null {
  return ({
    2: "hflip",
    3: "hflip,vflip",
    4: "vflip",
    5: "transpose=0",
    6: "transpose=1",
    7: "transpose=3",
    8: "transpose=2",
  } as Record<number, string>)[orientation] ?? null;
}

/**
 * The `-vf` chain for figure_from_image: RGB(A) first (on 4:2:0 JPEG data
 * ffmpeg rounds crop sizes and offsets to even numbers), then upright, then
 * the crop, whose box is in upright coordinates.
 */
export function imageFilter(
  format: "png" | "jpeg",
  orientation: number,
  boxPx: Box | null,
): string {
  return [
    `format=${format === "png" ? "rgba" : "rgb24"}`,
    orientFilter(orientation),
    boxPx ? `crop=${boxPx.w}:${boxPx.h}:${boxPx.x}:${boxPx.y}` : null,
  ].filter(Boolean).join(",");
}

/**
 * Pixel crop box from pixels or fractions (all four ≤ 1 → fractions of the
 * image), rounded and clamped to the image.
 */
export function boxToPixels(
  box: Box,
  img: { width: number; height: number },
): Box {
  const frac = [box.x, box.y, box.w, box.h].every((v) => v >= 0 && v <= 1);
  const b = frac
    ? {
      x: box.x * img.width,
      y: box.y * img.height,
      w: box.w * img.width,
      h: box.h * img.height,
    }
    : box;
  const x = Math.max(0, Math.min(Math.round(b.x), img.width - 1));
  const y = Math.max(0, Math.min(Math.round(b.y), img.height - 1));
  return {
    x,
    y,
    w: Math.max(1, Math.min(Math.round(b.w), img.width - x)),
    h: Math.max(1, Math.min(Math.round(b.h), img.height - y)),
  };
}

// ---------------------------------------------------------------------------
// Local papers folder (~/papers/<doi with / as _>.pdf + .json)

/** Paper metadata as filed next to the PDF. */
export interface PaperMeta {
  doi?: string;
  title?: string;
  year?: number | string;
  journal?: string;
  authors?: string[];
  volume?: string;
  page?: string;
}

/** A paper found in the papers folder. */
export interface FoundPaper {
  pdf: string;
  doi: string | null;
  key: string;
  citation: string;
  meta: PaperMeta | null;
}

/** DOI without resolver prefix. */
export function bareDoi(doi: string): string {
  return doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(
    /^doi:\s*/i,
    "",
  );
}

/** File stem for a DOI: `10.1038/nature08778` → `10.1038_nature08778`. */
export function doiStem(doi: string): string {
  return bareDoi(doi).replaceAll("/", "_");
}

/** True when the string looks like a DOI. */
export function isDoi(s: string): boolean {
  return /^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)?10\.\d{4,}\/\S+$/i.test(
    s.trim(),
  );
}

function surname(author: string): string {
  const parts = author.replace(/,.*$/, "").trim().split(/\s+/).filter((p) =>
    !/^(jr|sr|ii|iii|iv)\.?$/i.test(p)
  );
  return parts[parts.length - 1] ?? "";
}

const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Source key from metadata: first author's surname + year (`hirschey2010`). */
export function keyFromMeta(m: PaperMeta): string | null {
  const s = m.authors?.length ? surname(m.authors[0]) : "";
  if (!s || !m.year) return null;
  return slug(ascii(s) + String(m.year));
}

/** Journal names as the house style writes them (NLM abbreviations). */
export const JOURNAL_ABBREV: Record<string, string> = {
  "molecular cell": "Mol Cell",
  "cell metabolism": "Cell Metab",
  "cell reports": "Cell Rep",
  "journal of biological chemistry": "J Biol Chem",
  "the journal of biological chemistry": "J Biol Chem",
  "proceedings of the national academy of sciences": "Proc Natl Acad Sci USA",
  "proceedings of the national academy of sciences of the united states of america":
    "Proc Natl Acad Sci USA",
  "scientific reports": "Sci Rep",
  "nature communications": "Nat Commun",
  "nature medicine": "Nat Med",
  "nature cell biology": "Nat Cell Biol",
  "nature metabolism": "Nat Metab",
  "nature reviews molecular cell biology": "Nat Rev Mol Cell Biol",
  "nature structural & molecular biology": "Nat Struct Mol Biol",
  "molecular and cellular biology": "Mol Cell Biol",
  "biochemical and biophysical research communications":
    "Biochem Biophys Res Commun",
  "the embo journal": "EMBO J",
  "embo journal": "EMBO J",
  "genes & development": "Genes Dev",
  "aging cell": "Aging Cell",
  "cell": "Cell",
  "nature": "Nature",
  "science": "Science",
  "iscience": "iScience",
  "elife": "eLife",
};

/** "Molecular Cell" -> "Mol Cell"; unknown names are kept. */
export function abbrevJournal(name: string | undefined): string {
  const n = (name ?? "").replace(/\s+/g, " ").trim();
  return JOURNAL_ABBREV[n.toLowerCase()] ?? n;
}

const clean = (s: string) =>
  s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

/** Surname with its particles: "Anna M. van Dam" -> "van Dam". */
export function fullSurname(author: string): string {
  const a = clean(author);
  if (a.includes(",")) return a.split(",")[0].trim();
  const parts = a.split(" ").filter((p) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(p));
  let i = parts.length - 1;
  while (
    i > 0 &&
    /^(de|der|den|van|von|da|di|du|del|la|le|ten|ter|op)$/i.test(parts[i - 1])
  ) i--;
  return parts.slice(i).join(" ");
}

/** Initials without dots: "Anna M. van Dam" -> "AM". */
function initials(author: string): string {
  const a = clean(author);
  const given = a.includes(",")
    ? a.split(",").slice(1).join(" ")
    : a.slice(0, a.length - fullSurname(a).length);
  return given.split(/[\s.\-]+/).filter(Boolean).map((w) => w[0].toUpperCase())
    .join("");
}

/** Is `author` the person named `highlight` (a surname such as "van Dam")? */
export function isAuthor(
  author: string,
  highlight: string | undefined,
): boolean {
  if (!highlight) return false;
  const n = (s: string) => ascii(clean(s)).toLowerCase();
  return n(fullSurname(author)) === n(highlight);
}

/** "464:121" from volume and the first page of "121-125"; "" when unknown. */
function volPage(m: PaperMeta): string {
  const first = (m.page ?? "").split(/[-–]/)[0].trim();
  if (m.volume && first) return `${m.volume}:${first}`;
  return m.volume ?? "";
}

/**
 * Slide source line in house style, from the paper's metadata:
 * "Hirschey et al. 2010, Nature 464:121". When `highlight` (a surname) is an
 * author, the authors up to that name are listed and it is bolded:
 * "Okafor, Lindqvist, Santos, **van Dam** et al. 2017, Mol Cell 68:412".
 */
export function citationFromMeta(
  m: PaperMeta,
  highlight?: string,
): string | null {
  const a = (m.authors ?? []).map(clean);
  if (!a.length) return null;
  const s = a.map(fullSurname);
  const h = a.findIndex((x) => isAuthor(x, highlight));
  const b = (i: number) => (i === h ? `**${s[i]}**` : s[i]);
  let who: string;
  if (h < 0 || a.length <= 2) {
    who = a.length === 1
      ? b(0)
      : a.length === 2
      ? `${b(0)} & ${b(1)}`
      : `${b(0)} et al.`;
  } else if (a.length <= 5) {
    who = s.slice(0, -1).map((_, i) => b(i)).join(", ") +
      ` & ${b(a.length - 1)}`;
  } else if (h <= 3) {
    who = s.slice(0, h + 1).map((_, i) => b(i)).join(", ") + " et al.";
  } else {
    const tail = h === a.length - 1
      ? ""
      : h === a.length - 2
      ? ` & ${b(a.length - 1)}`
      : " et al.";
    who = `${b(0)}, ${b(1)} ... ${b(h)}${tail}`;
  }
  const where = [abbrevJournal(m.journal), volPage(m)].filter(Boolean).join(
    " ",
  );
  return [[who, m.year].filter(Boolean).join(" "), where].filter(Boolean)
    .join(", ");
}

/**
 * Full reference for the speaker notes, from the metadata: "Hirschey MD,
 * Shimazu T, … (2010) Title. Nature 464:121-125". Up to ten authors are
 * listed, else the first three, "…", the highlighted author when present, and
 * the last. No DOI (the slide adds it).
 */
export function referenceFromMeta(
  m: PaperMeta,
  highlight?: string,
): string | null {
  const a = (m.authors ?? []).map(clean);
  if (!a.length) return null;
  const name = (x: string) => {
    const t = `${fullSurname(x)} ${initials(x)}`.trim();
    return isAuthor(x, highlight) ? `**${t}**` : t;
  };
  let who: string;
  if (a.length <= 10) who = a.map(name).join(", ");
  else {
    const h = a.findIndex((x) => isAuthor(x, highlight));
    const mid = h >= 3 && h < a.length - 1 ? ` … ${name(a[h])}` : "";
    who = `${a.slice(0, 3).map(name).join(", ")}${mid} … ${
      name(a[a.length - 1])
    }`;
  }
  const pages = (m.page ?? "").replace(/-/g, "–");
  const where = [
    abbrevJournal(m.journal),
    m.volume && pages ? `${m.volume}:${pages}` : m.volume ?? "",
  ].filter(Boolean).join(" ");
  const title = clean(m.title ?? "").replace(/\.$/, "");
  return `${who} (${m.year ?? "n.d."})${title ? ` ${title}.` : ""} ${where}`
    .trim();
}

/** `~/x` → `$HOME/x`. */
export function expandHome(p: string): string {
  return p.startsWith("~/") ? `${Deno.env.get("HOME") ?? ""}${p.slice(1)}` : p;
}

async function exists(p: string): Promise<boolean> {
  return await Deno.stat(p).then(() => true, () => false);
}

async function readMeta(json: string): Promise<PaperMeta | null> {
  try {
    return JSON.parse(await Deno.readTextFile(json)) as PaperMeta;
  } catch {
    return null;
  }
}

async function found(
  pdf: string,
  doiHint: string | null,
): Promise<FoundPaper> {
  const meta = await readMeta(pdf.replace(/\.pdf$/i, ".json"));
  const doi = meta?.doi ? bareDoi(meta.doi) : doiHint;
  const stem = pdf.split("/").pop()!.replace(/\.pdf$/i, "");
  return {
    pdf,
    doi,
    key: (meta && keyFromMeta(meta)) ?? slug(stem),
    citation: (meta && citationFromMeta(meta)) ?? doi ?? stem,
    meta,
  };
}

/**
 * Find a paper in `dir` by DOI, by file stem, or by a key of first-author
 * surname + year matched against the `.json` metadata. Null when not found;
 * throws when a key matches several papers.
 */
export async function findPaper(
  dir: string,
  q: { doi?: string; key?: string },
): Promise<FoundPaper | null> {
  dir = expandHome(dir).replace(/\/$/, "");
  const doi = q.doi
    ? bareDoi(q.doi)
    : q.key && isDoi(q.key)
    ? bareDoi(q.key)
    : null;
  if (doi) {
    const pdf = `${dir}/${doiStem(doi)}.pdf`;
    return await exists(pdf) ? await found(pdf, doi) : null;
  }
  if (!q.key) return null;
  if (await exists(`${dir}/${q.key}.pdf`)) {
    return await found(`${dir}/${q.key}.pdf`, null);
  }
  const want = slug(q.key);
  const hits: FoundPaper[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith(".json")) continue;
      const meta = await readMeta(`${dir}/${e.name}`);
      if (!meta || keyFromMeta(meta) !== want) continue;
      const pdf = `${dir}/${e.name.replace(/\.json$/, ".pdf")}`;
      if (await exists(pdf)) hits.push(await found(pdf, null));
    }
  } catch {
    return null;
  }
  if (hits.length > 1) {
    throw new Error(
      `key "${q.key}" matches ${hits.length} papers in ${dir}: ${
        hits.map((h) => h.doi ?? h.pdf).join(", ")
      }; give doi=`,
    );
  }
  return hits[0] ?? null;
}

// ---------------------------------------------------------------------------
// Numbers on a slide vs the paper

/** Canonical unit and the pattern that recognises it (slide and paper). */
const UNITS: Array<[string, string]> = [
  ["%", "%|per\\s?cent\\b|percent\\b"],
  ["°C", "°\\s?C\\b|º\\s?C\\b|degrees?(?:\\s?C(?:elsius)?\\b)?"],
  ["-fold", "-?\\s?fold\\b|\\s?times\\b|\\s?x\\b|×"],
  ["mM", "mM\\b"],
  ["µM", "[µμ]M\\b"],
  ["nM", "nM\\b"],
  ["pM", "pM\\b"],
  ["mg", "mg\\b"],
  ["µg", "[µμ]g\\b"],
  ["ng", "ng\\b"],
  ["kg", "kg\\b"],
  ["g", "g\\b"],
  ["ml", "m[lL]\\b"],
  ["µl", "[µμ][lL]\\b"],
  ["kDa", "kDa\\b"],
  ["kcal", "kcal\\b"],
  ["mmol", "mmol\\b"],
  ["µmol", "[µμ]mol\\b"],
  ["nmol", "nmol\\b"],
  ["h", "h\\b|hrs?\\b|hours?\\b"],
  ["min", "min(?:utes?)?\\b"],
  ["days", "days?\\b"],
  ["weeks", "weeks?\\b|wk\\b"],
  ["months", "months?\\b"],
  ["years", "years?\\b|yr\\b"],
];
const UNIT_RE = new Map(
  UNITS.map(([u, p]) => [u, new RegExp(`^\\s?(?:${p})`)]),
);

/** A number with its unit, as written on the slide. */
export interface SlideNumber {
  text: string;
  value: string;
  unit: string;
  where: "shown" | "src" | "notes";
}

/**
 * Numbers followed by a unit or percent. Figure/table references, timing
 * marks and numbers glued to letters (Pkm2, 14C) are skipped.
 */
export function extractNumbers(
  text: string,
  where: SlideNumber["where"],
): SlideNumber[] {
  const out: SlideNumber[] = [];
  for (const m of text.matchAll(/(?<![\w.,/:\d])(\d+(?:\.\d+)?)/g)) {
    const before = text.slice(Math.max(0, m.index! - 14), m.index!);
    if (/(Fig(ure)?s?\.?|Tables?|Panels?|Ref\.?|n\s?=)\s*$/i.test(before)) {
      continue;
    }
    const rest = text.slice(m.index! + m[1].length);
    for (const [unit, re] of UNIT_RE) {
      const u = rest.match(re);
      if (u) {
        out.push({ text: m[1] + u[0], value: m[1], unit, where });
        break;
      }
    }
  }
  return out;
}

/** Paper text as one line: hyphenation joined, font quirks repaired. */
export function normalizePaperText(raw: string): string {
  return raw
    .replace(/(\w)-\n(?=[a-z])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/(\d)\s?uC\b/g, "$1 °C") // degree sign mapped to "u" in some fonts
    .trim();
}

const ABBREV =
  /(?:\bFig|\bFigs|\bal|\be\.g|\bi\.e|\bvs|\bref|\bRef|\bNo|\bca)$/;

/** The sentence around `idx` (bounded to ~300 characters each side). */
export function sentenceAt(text: string, idx: number): string {
  let s = Math.max(0, idx - 300);
  for (let i = idx - 1; i > idx - 300 && i > 0; i--) {
    if (
      /[.!?]/.test(text[i]) && text[i + 1] === " " &&
      /[A-Z([]/.test(text[i + 2] ?? "") &&
      !ABBREV.test(text.slice(Math.max(0, i - 5), i))
    ) {
      s = i + 2;
      break;
    }
  }
  let e = Math.min(text.length, idx + 300);
  for (let i = idx; i < idx + 300 && i < text.length; i++) {
    if (
      /[.!?]/.test(text[i]) && (text[i + 1] === " " || i + 1 === text.length) &&
      /[A-Z([]|^$/.test(text[i + 2] ?? "") &&
      !ABBREV.test(text.slice(Math.max(0, i - 5), i))
    ) {
      e = i + 1;
      break;
    }
  }
  let out = text.slice(s, e);
  // no sentence boundary within reach: cut at word boundaries and mark it
  if (s === idx - 300 && s > 0) out = "…" + out.replace(/^\S*\s/, "");
  if (e === idx + 300 && e < text.length) out = out.replace(/\s\S*$/, "") + "…";
  return out.trim();
}

/** About `width` characters of `sentence` centred on the first `value`. */
export function snippet(sentence: string, value: string, width = 200): string {
  if (sentence.length <= width) return sentence;
  const i = Math.max(
    0,
    sentence.search(
      new RegExp(`(?<![\\w.])${value.replace(".", "\\.")}(?!\\d)`),
    ),
  );
  const s = Math.max(0, Math.min(i - width / 2, sentence.length - width));
  return (s > 0 ? "…" : "") + sentence.slice(s, s + width).trim() +
    (s + width < sentence.length ? "…" : "");
}

/** Result for one number. */
export interface NumberCheck extends SlideNumber {
  status: "found" | "number-only" | "not-found";
  sentence: string | null;
}

/**
 * Look for a slide number in the paper text: `found` when the number occurs
 * with the same unit (% = per cent), `number-only` when it occurs but never
 * with that unit, `not-found` otherwise.
 */
export function checkNumber(paper: string, n: SlideNumber): NumberCheck {
  const re = new RegExp(
    `(?<![\\w.])${n.value.replace(".", "\\.")}(?!\\d|\\.\\d)`,
    "g",
  );
  const unit = UNIT_RE.get(n.unit)!;
  let firstBare: number | null = null;
  for (const m of paper.matchAll(re)) {
    const rest = paper.slice(m.index! + m[0].length);
    if (unit.test(rest)) {
      return { ...n, status: "found", sentence: sentenceAt(paper, m.index!) };
    }
    firstBare ??= m.index!;
  }
  return firstBare === null
    ? { ...n, status: "not-found", sentence: null }
    : { ...n, status: "number-only", sentence: sentenceAt(paper, firstBare) };
}

/** A slide's lines split into what is shown, the `.src` line and the notes. */
export interface SlideParts {
  shown: string[];
  src: string[];
  notes: string[];
}

/**
 * Split the slide whose heading is at 1-based `line` in `text`. Notes lines
 * that start with `Ref:`/`CHECK:` or are only a DOI are dropped (they hold
 * the citation and notes to self, not claims).
 */
export function slideParts(text: string, line: number): SlideParts {
  const lines = text.split("\n");
  const out: SlideParts = { shown: [], src: [], notes: [] };
  let inNotes = false, depth = 0;
  for (let i = line - 1; i < lines.length; i++) {
    const l = lines[i];
    if (i > line - 1 && /^#{1,2}\s/.test(l)) break;
    if (!inNotes && /^:{3,}\s*\{?\s*\.?notes\b/.test(l)) {
      inNotes = true;
      depth = 0;
      continue;
    }
    if (inNotes) {
      if (/^:{3,}\s*\S/.test(l)) depth++;
      else if (/^:{3,}\s*$/.test(l)) {
        if (depth === 0) {
          inNotes = false;
          continue;
        }
        depth--;
      }
      if (/^\s*(Ref:|CHECK:|doi:)/i.test(l)) continue;
      out.notes.push(l);
    } else if (/\{\.src\b/.test(l)) out.src.push(l);
    else out.shown.push(l);
  }
  return out;
}

/** Text of a source line without markup: div fences, images, {attributes}, tags. */
export function prose(line: string): string {
  if (/^\s*:{3,}/.test(line)) return "";
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/<[^>]*>/g, " ");
}

/** All numbers of a slide, de-duplicated by value + unit (first place kept). */
export function slideNumbers(parts: SlideParts): SlideNumber[] {
  const text = (ls: string[]) => ls.map(prose).join("\n");
  const all = [
    ...extractNumbers(text(parts.shown), "shown"),
    ...extractNumbers(text(parts.src), "src"),
    ...extractNumbers(text(parts.notes), "notes"),
  ];
  const seen = new Set<string>();
  return all.filter((n) => {
    const k = `${n.value}|${n.unit}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// External programs

async function run(
  cmd: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<Uint8Array> {
  // swamp-quality-ignore deno-command: poppler / ffmpeg on the author's files; argv array, no shell
  const o = await new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(timeoutMs),
  }).output();
  if (o.code !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed: ${new TextDecoder().decode(o.stderr)}`,
    );
  }
  return o.stdout;
}

/** Words of one PDF page. */
export async function pageLayout(
  pdf: string,
  page: number,
): Promise<PageLayout> {
  const x = new TextDecoder().decode(
    await run("pdftotext", [
      "-f",
      String(page),
      "-l",
      String(page),
      "-bbox-layout",
      pdf,
      "-",
    ]),
  );
  const p = parseBboxLayout(x)[0];
  if (!p) throw new Error(`no text layout for page ${page} of ${pdf}`);
  return p;
}

/** Plain reading-order text of a PDF, normalised for number search. */
export async function paperText(pdf: string): Promise<string> {
  return normalizePaperText(
    new TextDecoder().decode(await run("pdftotext", [pdf, "-"])),
  );
}

// ---------------------------------------------------------------------------
// Methods

type Handle = { name: string };
type Logger = { info: (msg: string, props?: Record<string, unknown>) => void };
/** The parts of the swamp method context these methods use. */
export interface FigCtx {
  globalArgs: {
    dir: string;
    main: string;
    sourcesDir: string;
    assetsDir: string;
    papersDir?: string;
  };
  logger: Logger;
  writeResource: (
    spec: string,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<Handle>;
  readResource?: (
    name: string,
    version?: number,
  ) => Promise<Record<string, unknown> | null>;
  createFileWriter: (spec: string, name: string) => {
    writeAll(content: Uint8Array): Promise<Handle>;
  };
}
/** Append journal entries (from `quarto_deck.ts`). */
export type JournalFn = (
  ctx: FigCtx,
  ...entries: Array<{ kind: "source" | "figure"; text: string; ref?: string }>
) => Promise<Handle>;

const papersDir = (ctx: FigCtx) => ctx.globalArgs.papersDir ?? "~/papers";

/**
 * Register a paper: from `pdf`, or (no pdf) from the papers folder by `doi`
 * or `key`. Key and citation default to the `.json` metadata.
 */
export async function registerSource(
  ctx: FigCtx,
  journal: JournalFn,
  args: { pdf?: string; key?: string; citation?: string; doi?: string },
): Promise<{ rec: SourceRecord; handles: Handle[] }> {
  const g = ctx.globalArgs;
  let pdf = args.pdf,
    key = args.key,
    citation = args.citation,
    doi = args.doi ?? null;
  let meta: PaperMeta | null = null;
  if (!pdf) {
    if (!args.doi && !args.key) {
      throw new Error("source_add needs pdf, doi or key");
    }
    const p = await findPaper(papersDir(ctx), { doi: args.doi, key: args.key });
    if (!p) {
      throw new Error(
        `no PDF for ${args.doi ?? args.key} in ${
          papersDir(ctx)
        } (expected <doi with / as _>.pdf)`,
      );
    }
    pdf = p.pdf;
    key = key && !isDoi(key) ? key : p.key;
    meta = p.meta;
    citation ??= p.citation;
    doi ??= p.doi;
    ctx.logger.info("found {pdf} ({citation})", { pdf, citation });
  }
  // a PDF given by path may have its .json next to it
  meta ??= await readMeta(expandHome(pdf).replace(/\.pdf$/i, ".json"));
  const fromMeta = meta ? citationFromMeta(meta) : null;
  if (fromMeta && citation && citation !== fromMeta) {
    ctx.logger.info(
      "citation from the paper's metadata is used: {m} (typed: {t})",
      { m: fromMeta, t: citation },
    );
  }
  if (fromMeta) citation = fromMeta;
  key ??= meta ? keyFromMeta(meta) ?? undefined : undefined;
  if (!key || !citation) {
    throw new Error(
      "source_add with pdf= and no .json metadata next to it also needs key= and citation=",
    );
  }
  key = slug(key);
  const storedRel = `${g.sourcesDir}/${key}.pdf`;
  const stored = `${g.dir}/${storedRel}`;
  await Deno.mkdir(`${g.dir}/${g.sourcesDir}`, { recursive: true });
  const src = await Deno.realPath(expandHome(pdf));
  if (src !== await Deno.realPath(stored).catch(() => "")) {
    await Deno.copyFile(src, stored);
  }
  const { pages, sizes } = await pdfGeometry(stored);
  const texts = await pageTexts(stored);
  const rec: SourceRecord = {
    key,
    citation,
    doi: doi ? bareDoi(doi) : null,
    original: src,
    stored: storedRel,
    sha256: await sha256File(stored),
    pages,
    pageSizes: sizes,
    captions: findCaptions(texts),
    ...(meta
      ? {
        meta: {
          authors: (meta.authors ?? []).map(clean),
          title: meta.title ?? null,
          journal: meta.journal ?? null,
          year: meta.year ? Number(meta.year) : null,
          volume: meta.volume ?? null,
          page: meta.page ?? null,
        },
        reference: referenceFromMeta(meta),
      }
      : {}),
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
  const h = await ctx.writeResource("source", `source-${key}`, { ...rec });
  const j = await journal(ctx, {
    kind: "source",
    text: `added ${citation} (${pages} pages) from ${src}`,
    ref: key,
  });
  return { rec, handles: [h, j] };
}

/**
 * The registered source for `key`; when unregistered and the key (or DOI)
 * resolves in the papers folder, register it now and say so.
 */
export async function ensureSource(
  ctx: FigCtx,
  journal: JournalFn,
  key: string,
): Promise<{ rec: SourceRecord; handles: Handle[] }> {
  const direct = await ctx.readResource?.(`source-${slug(key)}`) as
    | SourceRecord
    | null;
  if (direct) return { rec: direct, handles: [] };
  const p = await findPaper(papersDir(ctx), { key }).catch((e) => {
    throw new Error(`source "${key}" not registered — ${(e as Error).message}`);
  });
  if (!p) {
    throw new Error(
      `source "${key}" not registered — run source_add first, or file it as ${
        papersDir(ctx)
      }/<doi with / as _>.pdf`,
    );
  }
  const known = await ctx.readResource?.(`source-${p.key}`) as
    | SourceRecord
    | null;
  if (known) {
    ctx.logger.info("{key} is registered as {k}", { key, k: p.key });
    return { rec: known, handles: [] };
  }
  ctx.logger.info(
    "source {key} was not registered: auto-registered {k} from {pdf}",
    {
      key,
      k: p.key,
      pdf: p.pdf,
    },
  );
  return await registerSource(ctx, journal, {
    pdf: p.pdf,
    key: p.key,
    citation: p.citation,
    doi: p.doi ?? undefined,
  });
}

/** figure_crop arguments. */
export interface FigureCropArgs {
  key: string;
  page: number;
  box?: Box;
  anchor?: AnchorSpec;
  label: string;
  section: string;
  dpi: number;
  trim: boolean;
  pad: number;
  preview: boolean;
  previewDpi: number;
  outPng?: string;
}

/**
 * Crop a figure from a source page (box or anchors), or with `preview` draw
 * the box on the page instead. The PNG is always rendered at `dpi`, so
 * pixel = (point − boxPt.origin) × dpi/72, trimmed or not.
 */
export async function figureCrop(
  ctx: FigCtx,
  journal: JournalFn,
  args: FigureCropArgs,
): Promise<{ dataHandles: Handle[] }> {
  const g = ctx.globalArgs;
  if (!!args.box === !!args.anchor) {
    throw new Error("give box or anchor (one of them)");
  }
  const { rec, handles } = await ensureSource(ctx, journal, args.key);
  const size = rec.pageSizes.find((p) => p.page === args.page);
  if (!size) throw new Error(`${rec.key} has no page ${args.page}`);
  const pdf = `${g.dir}/${rec.stored}`;
  let requestedBoxPt: Box;
  let resolved: ResolvedAnchor | null = null;
  if (args.anchor) {
    resolved = resolveAnchor(await pageLayout(pdf, args.page), args.anchor);
    requestedBoxPt = resolved.box;
    const b = requestedBoxPt;
    ctx.logger.info("anchor box {x},{y} {w}x{h} pt", {
      x: b.x.toFixed(1),
      y: b.y.toFixed(1),
      w: b.w.toFixed(1),
      h: b.h.toFixed(1),
    });
    for (const [edge, why] of Object.entries(resolved.edges)) {
      ctx.logger.info("  {edge}: {why}", { edge, why });
    }
  } else {
    requestedBoxPt = boxToPoints(args.box!, size);
  }
  let boxPt = requestedBoxPt;
  if (args.trim) {
    const measureDpi = 144;
    const ink = inkBounds(parsePpm(
      await renderPpm({
        pdf,
        page: args.page,
        dpi: measureDpi,
        cropPx: pixelCrop(requestedBoxPt, measureDpi),
      }),
    ));
    if (!ink) throw new Error(`the box on ${rec.key} p${args.page} is blank`);
    boxPt = trimmedBox(requestedBoxPt, ink, measureDpi, args.pad);
  }
  const label = slug(args.label);

  if (args.preview) {
    const s = args.previewDpi / 72;
    const img = parsePpm(
      await renderPpm({
        pdf,
        page: args.page,
        dpi: args.previewDpi,
        cropPx: {
          x: 0,
          y: 0,
          W: Math.ceil(size.width * s),
          H: Math.ceil(size.height * s),
        },
      }),
    );
    if (args.trim) {
      drawRect(
        img,
        pixelCrop(requestedBoxPt, args.previewDpi),
        [120, 120, 255],
        1,
      );
    }
    if (resolved) {
      for (
        const m of [resolved.from, resolved.to].filter((m): m is WordMatch =>
          !!m
        )
      ) {
        drawRect(
          img,
          pixelCrop({
            x: m.xMin,
            y: m.yMin,
            w: m.xMax - m.xMin,
            h: m.yMax - m.yMin,
          }, args.previewDpi),
          [0, 90, 255],
          2,
        );
      }
    }
    drawGrid(img, args.previewDpi);
    drawRect(img, pixelCrop(boxPt, args.previewDpi), [230, 0, 0], 3);
    const png = await encodePng(img);
    const out = args.outPng ??
      `${await Deno.makeTempDir({
        prefix: "quarto-deck-preview-",
      })}/${rec.key}_p${args.page}_${label}.png`;
    await Deno.writeFile(out, png);
    ctx.logger.info("preview (red = crop box{t}): {out}", {
      out,
      t: args.trim ? ", thin blue = box before trim" : "",
    });
    ctx.logger.info("box {x},{y} {w}x{h} pt; nothing cropped", {
      x: boxPt.x.toFixed(1),
      y: boxPt.y.toFixed(1),
      w: boxPt.w.toFixed(1),
      h: boxPt.h.toFixed(1),
    });
    const h = await ctx.createFileWriter(
      "pagePreview",
      `preview-${rec.key}-p${args.page}-${label}`,
    ).writeAll(png);
    return { dataHandles: [...handles, h] };
  }

  const png = await renderPage({
    pdf,
    page: args.page,
    dpi: args.dpi,
    cropPx: pixelCrop(boxPt, args.dpi),
  });
  const rel = `${g.assetsDir}/${slug(args.section)}/${rec.key}_${label}.png`;
  await Deno.mkdir(`${g.dir}/${g.assetsDir}/${slug(args.section)}`, {
    recursive: true,
  });
  await Deno.writeFile(`${g.dir}/${rel}`, png);
  const { width, height } = pngSize(png);
  const fig: FigureRecord & Record<string, unknown> = {
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
    pxPerPt: args.dpi / 72,
    ...(args.anchor
      ? { anchor: args.anchor, anchorEdges: resolved!.edges }
      : {}),
    path: rel,
    widthPx: width,
    heightPx: height,
    sha256: await sha256File(`${g.dir}/${rel}`),
    createdAt: new Date().toISOString(),
  };
  ctx.logger.info(
    "{path}: {w}x{h}px from {key} p{page}, box {x},{y} {bw}x{bh} pt, {s} px/pt",
    {
      path: rel,
      w: width,
      h: height,
      key: rec.key,
      page: args.page,
      x: boxPt.x.toFixed(1),
      y: boxPt.y.toFixed(1),
      bw: boxPt.w.toFixed(1),
      bh: boxPt.h.toFixed(1),
      s: (args.dpi / 72).toFixed(3),
    },
  );
  const h = await ctx.writeResource("figure", `figure-${rec.key}-${label}`, {
    ...fig,
  });
  const j = await journal(ctx, {
    kind: "figure",
    text: `cropped ${args.label} from ${rec.citation}, p${args.page} → ${rel}`,
    ref: `${rec.key}-${label}`,
  });
  return { dataHandles: [...handles, h, j] };
}

/** figure_from_image arguments. */
export interface FromImageArgs {
  image: string;
  box?: Box;
  label: string;
  section: string;
  credit: string;
  rights?: string;
}

/**
 * Crop an image file (screenshot, publisher figure, photo) with ffmpeg into
 * `assets/<section>/<label>.png`; keep a copy of the original under
 * `sources/images/` and record credit, rights and the pixel box.
 */
export async function figureFromImage(
  ctx: FigCtx,
  journal: JournalFn,
  args: FromImageArgs,
): Promise<{ dataHandles: Handle[] }> {
  const g = ctx.globalArgs;
  const src = await Deno.realPath(expandHome(args.image));
  const bytes = await Deno.readFile(src);
  const stored = imageSize(bytes);
  if (!stored) throw new Error(`${src}: not a PNG or JPEG`);
  // the box is drawn on the photo as shown, i.e. after EXIF rotation
  const orientation = stored.format === "jpeg" ? exifOrientation(bytes) : 1;
  const size = orientation >= 5
    ? { ...stored, width: stored.height, height: stored.width }
    : stored;
  const label = slug(args.label);
  const ext = size.format === "png" ? "png" : "jpg";
  const keptRel = `${g.sourcesDir}/images/${label}.${ext}`;
  await Deno.mkdir(`${g.dir}/${g.sourcesDir}/images`, { recursive: true });
  if (src !== await Deno.realPath(`${g.dir}/${keptRel}`).catch(() => "")) {
    await Deno.writeFile(`${g.dir}/${keptRel}`, bytes);
  }
  const boxPx = args.box ? boxToPixels(args.box, size) : null;
  const rel = `${g.assetsDir}/${slug(args.section)}/${label}.png`;
  await Deno.mkdir(`${g.dir}/${g.assetsDir}/${slug(args.section)}`, {
    recursive: true,
  });
  // rotation is applied explicitly (-noautorotate: never twice, whatever
  // the ffmpeg version does with EXIF)
  await run("ffmpeg", [
    "-nostdin",
    "-y",
    "-v",
    "error",
    "-noautorotate",
    "-i",
    src,
    "-vf",
    imageFilter(size.format, orientation, boxPx),
    "-frames:v",
    "1",
    "-update",
    "1",
    `${g.dir}/${rel}`,
  ]);
  const out = await Deno.readFile(`${g.dir}/${rel}`);
  const { width, height } = pngSize(out);
  if (boxPx && (width !== boxPx.w || height !== boxPx.h)) {
    throw new Error(
      `crop came out ${width}x${height}, expected ${boxPx.w}x${boxPx.h}`,
    );
  }
  const rec = {
    label,
    section: slug(args.section),
    original: src,
    kept: keptRel,
    sourceSha256: await sha256File(`${g.dir}/${keptRel}`),
    imageWidthPx: size.width,
    imageHeightPx: size.height,
    exifOrientation: orientation,
    boxPx,
    credit: args.credit,
    rights: args.rights ?? null,
    path: rel,
    widthPx: width,
    heightPx: height,
    sha256: await sha256File(`${g.dir}/${rel}`),
    createdAt: new Date().toISOString(),
  };
  ctx.logger.info(
    "{path}: {w}x{h}px from {src} ({iw}x{ih}){box}; credit: {credit}",
    {
      path: rel,
      w: width,
      h: height,
      src,
      iw: size.width,
      ih: size.height,
      box: (boxPx ? ` box ${boxPx.x},${boxPx.y} ${boxPx.w}x${boxPx.h}` : "") +
        (orientation !== 1 ? ` (EXIF orientation ${orientation} applied)` : ""),
      credit: args.credit,
    },
  );
  const h = await ctx.writeResource("image", `image-${label}`, rec);
  const j = await journal(ctx, {
    kind: "figure",
    text: `image ${args.label} from ${src} (${args.credit}) → ${rel}`,
    ref: `image-${label}`,
  });
  return { dataHandles: [h, j] };
}

/** One slide checked by verify_numbers. */
export interface SlideVerdict {
  title: string;
  file: string;
  line: number;
  doi: string | null;
  paper: string | null;
  numbers: NumberCheck[];
  note: string | null;
}

/**
 * For each slide: numbers with units in shown text, `.src` and notes, looked
 * up in the paper of the notes' DOI (registered source, else papers folder).
 */
export async function verifyNumbers(
  ctx: FigCtx,
  slides: Array<{ title: string; file: string; line: number; dois: string[] }>,
  name: string,
): Promise<{ dataHandles: Handle[] }> {
  const g = ctx.globalArgs;
  const texts = new Map<string, string>();
  const out: SlideVerdict[] = [];
  for (const s of slides) {
    const parts = slideParts(
      await Deno.readTextFile(`${g.dir}/${s.file}`),
      s.line,
    );
    const nums = slideNumbers(parts);
    const doi = s.dois[0] ? bareDoi(s.dois[0]) : null;
    const v: SlideVerdict = {
      title: s.title,
      file: s.file,
      line: s.line,
      doi,
      paper: null,
      numbers: [],
      note: null,
    };
    out.push(v);
    if (!nums.length) {
      v.note = "no numbers with units";
      continue;
    }
    let pdf: string | null = null;
    if (doi) {
      const p = await findPaper(papersDir(ctx), { doi });
      if (p) {
        const reg = await ctx.readResource?.(`source-${p.key}`) as
          | SourceRecord
          | null;
        pdf = reg ? `${g.dir}/${reg.stored}` : p.pdf;
        v.paper = reg
          ? `${reg.citation} (registered ${reg.key})`
          : `${p.citation} (${p.pdf})`;
      }
    }
    if (!pdf) {
      v.note = doi
        ? `no PDF for doi ${doi} in ${papersDir(ctx)}`
        : "no DOI in the notes";
      v.numbers = nums.map((n) => ({
        ...n,
        status: "not-found" as const,
        sentence: null,
      }));
    } else {
      if (!texts.has(pdf)) texts.set(pdf, await paperText(pdf));
      v.numbers = nums.map((n) => checkNumber(texts.get(pdf!)!, n));
    }
    ctx.logger.info("{title} — {paper}", {
      title: s.title,
      paper: v.paper ?? v.note,
    });
    for (const n of v.numbers) {
      ctx.logger.info("  {flag} {text} ({where}){sentence}", {
        flag: n.status === "found"
          ? "ok      "
          : n.status === "number-only"
          ? "UNIT?   "
          : "MISSING ",
        text: n.text,
        where: n.where,
        sentence: n.sentence ? `: "${snippet(n.sentence, n.value)}"` : "",
      });
    }
  }
  const h = await ctx.writeResource("numbers", name, {
    slides: out as unknown as Record<string, unknown>[],
    checkedAt: new Date().toISOString(),
  });
  return { dataHandles: [h] };
}
