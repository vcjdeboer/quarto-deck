/**
 * Paper PDFs as deck sources: register a PDF (checksum, pages, per-page text,
 * figure/table caption index), search its text, render a page preview, and
 * crop a figure or table into the deck's assets with a provenance record.
 * Uses poppler (`pdfinfo`, `pdftotext`, `pdftoppm`).
 * @module
 */

/** A figure/table caption found in the text. */
export interface Caption {
  page: number;
  label: string;
  text: string;
}

/** A registered source. */
export interface SourceRecord {
  key: string;
  citation: string;
  doi: string | null;
  original: string;
  stored: string;
  sha256: string;
  pages: number;
  pageSizes: Array<{ page: number; width: number; height: number }>;
  captions: Caption[];
  addedAt: string;
}

/** A text hit. */
export interface Hit {
  page: number;
  line: string;
}

/** A cropped figure with its provenance. */
export interface FigureRecord {
  key: string;
  label: string;
  citation: string;
  doi: string | null;
  sourceSha256: string;
  page: number;
  /** Crop box in PDF points, origin top-left: x, y, width, height. */
  boxPt: { x: number; y: number; w: number; h: number };
  dpi: number;
  path: string;
  widthPx: number;
  heightPx: number;
  sha256: string;
  createdAt: string;
}

const CAPTION_RE =
  /^\s*((?:Fig(?:ure)?|FIG(?:URE)?|Table|TABLE|Tabelle|Abb(?:ildung)?)\.?\s*[0-9IVX]+[A-Za-z]?)\b[.:]?\s*(.*)$/;

/** Find figure/table captions in the text of each page (pages 1-based). */
export function findCaptions(pageTexts: string[]): Caption[] {
  const out: Caption[] = [];
  pageTexts.forEach((txt, i) => {
    for (const line of txt.split("\n")) {
      const m = line.match(CAPTION_RE);
      // "Table II below." is running text, not a caption
      if (m && !/^[a-z]/.test(m[2].trim())) {
        out.push({
          page: i + 1,
          label: m[1].replace(/\s+/g, " ").trim(),
          text: m[2].trim().slice(0, 160),
        });
      }
    }
  });
  return out;
}

/** Case-insensitive search; matching lines with their page, at most `max`. */
export function searchPages(
  pageTexts: string[],
  query: string,
  max = 50,
): Hit[] {
  const q = query.toLowerCase();
  const hits: Hit[] = [];
  pageTexts.forEach((txt, i) => {
    for (const line of txt.split("\n")) {
      if (hits.length < max && line.toLowerCase().includes(q)) {
        hits.push({ page: i + 1, line: line.trim().replace(/\s+/g, " ") });
      }
    }
  });
  return hits;
}

/**
 * Crop box in PDF points from either points or fractions of the page
 * (all four values ≤ 1 → fractions). Clamped to the page.
 */
export function boxToPoints(
  box: { x: number; y: number; w: number; h: number },
  page: { width: number; height: number },
): { x: number; y: number; w: number; h: number } {
  const frac = [box.x, box.y, box.w, box.h].every((v) => v >= 0 && v <= 1);
  const b = frac
    ? {
      x: box.x * page.width,
      y: box.y * page.height,
      w: box.w * page.width,
      h: box.h * page.height,
    }
    : { ...box };
  const x = Math.max(0, Math.min(b.x, page.width));
  const y = Math.max(0, Math.min(b.y, page.height));
  return {
    x,
    y,
    w: Math.max(1, Math.min(b.w, page.width - x)),
    h: Math.max(1, Math.min(b.h, page.height - y)),
  };
}

/** Points → pixel crop arguments for pdftoppm at `dpi`. */
export function pixelCrop(
  boxPt: { x: number; y: number; w: number; h: number },
  dpi: number,
): { x: number; y: number; W: number; H: number } {
  const s = dpi / 72;
  return {
    x: Math.round(boxPt.x * s),
    y: Math.round(boxPt.y * s),
    W: Math.round(boxPt.w * s),
    H: Math.round(boxPt.h * s),
  };
}

/** Lower-case slug for file names. */
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

async function run(cmd: string, args: string[]): Promise<string> {
  // swamp-quality-ignore deno-command: poppler (pdfinfo/pdftotext/pdftoppm) reads paper PDFs; argv array, no shell
  const o = await new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (o.code !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed: ${new TextDecoder().decode(o.stderr)}`,
    );
  }
  return new TextDecoder().decode(o.stdout);
}

/** SHA-256 hex of a file. */
export async function sha256File(path: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Page count and per-page sizes in points. */
export async function pdfGeometry(pdf: string): Promise<
  {
    pages: number;
    sizes: Array<{ page: number; width: number; height: number }>;
  }
> {
  const head = await run("pdfinfo", [pdf]);
  const pages = Number(head.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
  const all = await run("pdfinfo", ["-f", "1", "-l", String(pages), pdf]);
  const sizes: Array<{ page: number; width: number; height: number }> = [];
  for (
    const m of all.matchAll(/^Page\s+(\d+)\s+size:\s+([\d.]+)\s+x\s+([\d.]+)/gm)
  ) {
    sizes.push({
      page: Number(m[1]),
      width: Number(m[2]),
      height: Number(m[3]),
    });
  }
  // some pdfinfo builds report rotated pages; fall back to the document size
  if (!sizes.length) {
    const m = head.match(/^Page size:\s+([\d.]+)\s+x\s+([\d.]+)/m);
    const width = Number(m?.[1] ?? 612), height = Number(m?.[2] ?? 792);
    for (let p = 1; p <= pages; p++) sizes.push({ page: p, width, height });
  }
  return { pages, sizes };
}

/** Text of every page (layout-preserving). */
export async function pageTexts(pdf: string): Promise<string[]> {
  const txt = await run("pdftotext", ["-layout", pdf, "-"]);
  const pages = txt.split("\f");
  if (pages.length && pages[pages.length - 1].trim() === "") pages.pop();
  return pages;
}

/** Render one page (or a crop of it) to PNG bytes. */
export async function renderPage(opts: {
  pdf: string;
  page: number;
  dpi: number;
  cropPx?: { x: number; y: number; W: number; H: number };
}): Promise<Uint8Array> {
  const dir = await Deno.makeTempDir({ prefix: "quarto-deck-page-" });
  try {
    const crop = opts.cropPx
      ? [
        "-x",
        String(opts.cropPx.x),
        "-y",
        String(opts.cropPx.y),
        "-W",
        String(opts.cropPx.W),
        "-H",
        String(opts.cropPx.H),
      ]
      : [];
    await run("pdftoppm", [
      "-f",
      String(opts.page),
      "-l",
      String(opts.page),
      "-r",
      String(opts.dpi),
      ...crop,
      "-png",
      "-singlefile",
      opts.pdf,
      `${dir}/p`,
    ]);
    return await Deno.readFile(`${dir}/p.png`);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

/** Width and height of a PNG from its IHDR chunk. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}
