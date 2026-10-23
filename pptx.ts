/**
 * Reuse old PowerPoint decks: inventory (titles, notes, media, hidden), pull
 * the original media out at full resolution, list a slide's shapes, build a
 * copy of one slide that keeps only chosen shapes ("layers", e.g. for a GSAP
 * animation), and render slides to PNG through Keynote (macOS).
 * @module
 */
import JSZip from "npm:jszip@3.10.1";

/** One slide of a pptx. */
export interface PptxSlide {
  /** 1-based position in the deck. */
  n: number;
  /** Zip path, e.g. ppt/slides/slide15.xml (not always slide<n>). */
  part: string;
  title: string;
  text: string[];
  notes: string;
  hidden: boolean;
  media: string[];
}

/** A top-level shape of a slide. */
export interface PptxShape {
  id: string;
  name: string;
  kind: string;
  text: string;
}

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Text runs (<a:t>) of an XML fragment, joined per paragraph. */
export function paragraphs(xml: string): string[] {
  const out: string[] = [];
  for (
    const p of xml.match(/<a:p>[\s\S]*?<\/a:p>|<a:p [\s\S]*?<\/a:p>/g) ?? []
  ) {
    const t = [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
      decode(m[1])
    ).join("");
    if (t.trim()) out.push(t.trim());
  }
  return out;
}

/** Relationship id → target for a .rels part. */
export function parseRels(
  xml: string,
): Map<string, { target: string; type: string }> {
  const m = new Map<string, { target: string; type: string }>();
  for (const r of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = r[0].match(/\bId="([^"]+)"/)?.[1];
    const target = r[0].match(/\bTarget="([^"]+)"/)?.[1];
    const type = r[0].match(/\bType="([^"]+)"/)?.[1] ?? "";
    if (id && target) m.set(id, { target, type });
  }
  return m;
}

/** Resolve a relative zip target against the folder of `from`. */
export function resolvePart(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** Split the children of <p:spTree> into top-level XML elements. */
export function topLevelChildren(inner: string): string[] {
  const tops: string[] = [];
  let depth = 0, start = -1;
  for (const m of inner.matchAll(/<(\/?)(p:[A-Za-z]+)\b[^>]*?(\/?)>/g)) {
    const [whole, close, , selfClose] = m;
    const at = m.index!;
    if (!close && !selfClose) {
      if (depth === 0) start = at;
      depth++;
    } else if (close) {
      depth--;
      if (depth === 0) tops.push(inner.slice(start, at + whole.length));
    } else if (depth === 0) tops.push(whole);
  }
  return tops;
}

/** Shape id (cNvPr id) of a top-level element. */
export function shapeId(xml: string): string | null {
  return xml.match(/<p:cNvPr\b[^>]*\bid="(\d+)"/)?.[1] ?? null;
}

/** Describe the top-level shapes of a slide. */
export function listShapes(slideXml: string): PptxShape[] {
  const a = slideXml.indexOf("<p:spTree>");
  const b = slideXml.indexOf("</p:spTree>");
  if (a < 0 || b < 0) return [];
  return topLevelChildren(slideXml.slice(a + 10, b))
    .filter((t) => !t.startsWith("<p:nvGrpSpPr") && !t.startsWith("<p:grpSpPr"))
    .map((t) => ({
      id: shapeId(t) ?? "",
      name: decode(t.match(/<p:cNvPr\b[^>]*\bname="([^"]*)"/)?.[1] ?? ""),
      kind: t.match(/^<p:(\w+)/)?.[1] ?? "",
      text: paragraphs(t).join(" / ").slice(0, 120),
    }));
}

/**
 * Keep only some top-level shapes of a slide (or drop some). Animation timing
 * is removed so nothing starts hidden.
 */
export function filterShapes(
  slideXml: string,
  opts: { keep?: string[]; drop?: string[] },
): string {
  const a = slideXml.indexOf("<p:spTree>");
  const b = slideXml.indexOf("</p:spTree>");
  if (a < 0 || b < 0) throw new Error("slide has no <p:spTree>");
  const kept = topLevelChildren(slideXml.slice(a + 10, b)).filter((t) => {
    if (t.startsWith("<p:nvGrpSpPr") || t.startsWith("<p:grpSpPr")) return true;
    const id = shapeId(t) ?? "";
    if (opts.keep) return opts.keep.includes(id);
    return !(opts.drop ?? []).includes(id);
  });
  return (slideXml.slice(0, a) + "<p:spTree>" + kept.join("") +
    slideXml.slice(b))
    .replace(/<p:timing>[\s\S]*?<\/p:timing>/, "");
}

/** Set or clear show="0" (hidden) on a slide root. */
export function setHidden(slideXml: string, hidden: boolean): string {
  const root = slideXml.match(/<p:sld\b[^>]*>/);
  if (!root) return slideXml;
  let tag = root[0].replace(/\sshow="[^"]*"/, "");
  if (hidden) tag = tag.replace(/^<p:sld\b/, '<p:sld show="0"');
  return slideXml.replace(root[0], tag);
}

/** Slide parts in presentation order. */
async function slideOrder(zip: JSZip): Promise<string[]> {
  const pres = await zip.file("ppt/presentation.xml")?.async("string");
  const rels = await zip.file("ppt/_rels/presentation.xml.rels")?.async(
    "string",
  );
  if (!pres || !rels) throw new Error("not a pptx (no ppt/presentation.xml)");
  const map = parseRels(rels);
  return [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
    .map((m) => map.get(m[1])?.target)
    .filter((t): t is string => !!t)
    .map((t) => resolvePart("ppt/presentation.xml", t));
}

/** Load a pptx from bytes. */
export async function loadPptx(bytes: Uint8Array): Promise<JSZip> {
  return await JSZip.loadAsync(bytes);
}

/** Open a pptx file. */
export async function openPptx(path: string): Promise<JSZip> {
  return await JSZip.loadAsync(await Deno.readFile(path));
}

/** Inventory every slide: title, text, notes, hidden, media. */
export async function inventory(zip: JSZip): Promise<PptxSlide[]> {
  const order = await slideOrder(zip);
  const out: PptxSlide[] = [];
  for (const [i, part] of order.entries()) {
    const xml = (await zip.file(part)?.async("string")) ?? "";
    const relsPath = part.replace(
      /slides\/(slide\d+\.xml)$/,
      "slides/_rels/$1.rels",
    );
    const rels = parseRels((await zip.file(relsPath)?.async("string")) ?? "");
    let title = "";
    for (
      const sp of topLevelChildren(
        xml.slice(xml.indexOf("<p:spTree>") + 10, xml.indexOf("</p:spTree>")),
      )
    ) {
      if (/<p:ph\b[^>]*type="(title|ctrTitle)"/.test(sp)) {
        title = paragraphs(sp).join(" ");
        break;
      }
    }
    let notes = "";
    const media: string[] = [];
    for (const r of rels.values()) {
      const target = resolvePart(part, r.target);
      if (r.type.endsWith("/notesSlide")) {
        const nx = (await zip.file(target)?.async("string")) ?? "";
        // body placeholder only, not the slide-image or number placeholders
        notes = topLevelChildren(
          nx.slice(nx.indexOf("<p:spTree>") + 10, nx.indexOf("</p:spTree>")),
        )
          .filter((sp) => /<p:ph\b[^>]*type="body"/.test(sp))
          .flatMap(paragraphs).join("\n");
      } else if (/\/(image|media|video|audio)$/.test(r.type)) {
        if (!media.includes(target)) media.push(target);
      }
    }
    out.push({
      n: i + 1,
      part,
      title,
      text: paragraphs(xml),
      notes,
      hidden: /<p:sld\b[^>]*\bshow="0"/.test(xml),
      media,
    });
  }
  return out;
}

/** Shapes of slide `n`. */
export async function slideShapes(zip: JSZip, n: number): Promise<PptxShape[]> {
  const part = (await slideOrder(zip))[n - 1];
  if (!part) throw new Error(`no slide ${n}`);
  return listShapes((await zip.file(part)?.async("string")) ?? "");
}

/**
 * A copy of the deck in which slide `n` keeps only the chosen shapes and every
 * other slide is hidden (so an export with skipped slides off yields one image).
 */
export async function layerCopy(
  src: Uint8Array,
  n: number,
  opts: { keep?: string[]; drop?: string[] },
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(src);
  const order = await slideOrder(zip);
  if (!order[n - 1]) throw new Error(`no slide ${n}`);
  for (const [i, part] of order.entries()) {
    let xml = (await zip.file(part)?.async("string")) ?? "";
    if (i === n - 1) xml = setHidden(filterShapes(xml, opts), false);
    else xml = setHidden(xml, true);
    zip.file(part, xml);
  }
  return await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
}

async function osa(script: string, timeoutMs: number): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // swamp-quality-ignore deno-command: Keynote is only scriptable via osascript; the script is fed on stdin and paths are escaped
    const o = await new Deno.Command("osascript", {
      args: ["-"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
      signal: ac.signal,
    }).spawn();
    const w = o.stdin.getWriter();
    await w.write(new TextEncoder().encode(script));
    await w.close();
    const r = await o.output();
    if (r.code !== 0) {
      throw new Error(new TextDecoder().decode(r.stderr).trim());
    }
    return new TextDecoder().decode(r.stdout).trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Render the (non-hidden) slides of a pptx to PNGs with Keynote: Keynote
 * exports a vector PDF, poppler rasterises it at `dpi` (Keynote's own slide
 * images are only 720 px wide). Returns PNG paths in slide order. Keynote may
 * show a font/compatibility dialog; if the export times out, look at Keynote.
 */
export async function keynoteExport(
  pptx: string,
  outDir: string,
  opts: { dpi?: number; timeoutMs?: number } = {},
): Promise<string[]> {
  if (Deno.build.os !== "darwin") throw new Error("Keynote export needs macOS");
  const timeoutMs = opts.timeoutMs ?? 600000;
  await Deno.mkdir(outDir, { recursive: true });
  const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const pdf = `${outDir}/slides.pdf`;
  await osa(
    `with timeout of ${Math.floor(timeoutMs / 1000) - 5} seconds
tell application "Keynote"
  set d to open POSIX file "${q(pptx)}"
  delay 2
  export d to POSIX file "${
      q(pdf)
    }" as PDF with properties {PDF image quality:Best, skipped slides:false}
  close d saving no
end tell
end timeout`,
    timeoutMs,
  );
  // swamp-quality-ignore deno-command: poppler pdftoppm rasterises the Keynote PDF; argv array, no shell
  const r = await new Deno.Command("pdftoppm", {
    args: ["-r", String(opts.dpi ?? 200), "-png", pdf, `${outDir}/slide`],
    stderr: "piped",
  }).output();
  if (r.code !== 0) {
    throw new Error(`pdftoppm failed: ${new TextDecoder().decode(r.stderr)}`);
  }
  const files: string[] = [];
  for await (const e of Deno.readDir(outDir)) {
    if (e.isFile && /^slide-\d+\.png$/.test(e.name)) {
      files.push(`${outDir}/${e.name}`);
    }
  }
  const num = (f: string) => Number(f.match(/-(\d+)\.png$/)?.[1] ?? 0);
  return files.sort((x, y) => num(x) - num(y));
}

/** Make near-white pixels transparent (ffmpeg colorkey), for stackable layers. */
export async function knockOutWhite(
  input: string,
  out: string,
  similarity = 0.02,
): Promise<void> {
  // swamp-quality-ignore deno-command: ffmpeg colorkey for transparent layers; argv array, no shell
  const r = await new Deno.Command("ffmpeg", {
    args: [
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-vf",
      `colorkey=white:${similarity}:0.0,format=rgba`,
      out,
    ],
    stderr: "piped",
  }).output();
  if (r.code !== 0) {
    throw new Error(
      `ffmpeg colorkey failed: ${new TextDecoder().decode(r.stderr)}`,
    );
  }
}

/** File name for an extracted media item. */
export function mediaName(deck: string, n: number, part: string): string {
  const base = part.split("/").pop() ?? "media";
  return `${deck}_s${String(n).padStart(2, "0")}_${base}`;
}

/** Quarto stub for ported slides: title, media, notes, a CHECK to sort it. */
export function qmdStub(
  deck: string,
  slides: PptxSlide[],
  imagePaths: Map<number, string[]>,
): string {
  const out: string[] = [];
  for (const s of slides) {
    out.push(`## ${s.title || `Slide ${s.n} from ${deck}`}`, "");
    for (const p of imagePaths.get(s.n) ?? []) {
      out.push(
        `![](${p}){style="max-height: 480px; display: block; margin: 0 auto;"}`,
        "",
      );
    }
    out.push("::: notes");
    out.push(
      `~1'. ${s.notes.replace(/\s*\n\s*/g, " ").trim() || s.text.join(". ")}`,
    );
    out.push(
      `CHECK: ported from ${deck} slide ${s.n}; sort it: reuse photo/data, redraw schematic, or re-crop paper figure; title = message`,
    );
    out.push(":::", "");
  }
  return out.join("\n");
}

/** True for Keynote documents. */
export function isKeynote(path: string): boolean {
  return /\.key\/?$/i.test(path);
}

/**
 * Give `fn` a .pptx path for `path`: the file itself, or, for a Keynote .key,
 * a temporary PowerPoint export made by Keynote (from a copy when the .key is
 * a single file, so the original is never opened). Temp files are removed.
 */
export async function withPptx<T>(
  path: string,
  fn: (pptx: string) => Promise<T>,
  timeoutMs = 600000,
): Promise<T> {
  if (!isKeynote(path)) return await fn(path);
  if (Deno.build.os !== "darwin") {
    throw new Error("reading .key needs Keynote (macOS)");
  }
  const dir = await Deno.makeTempDir({ prefix: "quarto-deck-key2pptx-" });
  try {
    const st = await Deno.stat(path);
    const src = st.isFile ? `${dir}/source.key` : path;
    if (st.isFile) await Deno.copyFile(path, src);
    const out = `${dir}/converted.pptx`;
    const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    await osa(
      `with timeout of ${Math.floor(timeoutMs / 1000) - 5} seconds
tell application "Keynote"
  set d to open POSIX file "${q(src)}"
  delay 2
  export d to POSIX file "${q(out)}" as Microsoft PowerPoint
  close d saving no
end tell
end timeout`,
      timeoutMs,
    );
    await Deno.stat(out).catch(() => {
      throw new Error(`Keynote did not export ${path} to PowerPoint`);
    });
    return await fn(out);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}
