/**
 * Edit slides in place: insert, move (across section files), delete (park in
 * the hold file), replace an image under a new content-hashed name, and undo
 * any of it from a snapshot.
 *
 * A slide is addressed by
 * - its **title** (case-insensitive substring of the heading; for an untitled
 *   slide such as `## {.statement .center}`, of the text it shows), which must
 *   match one slide across all included files;
 * - its **number** in the built deck's slide counter (title slide = 1, hidden
 *   and `uncounted` slides get no number), when that can be computed from the
 *   source (see `counterNumbers`);
 * - or `file.qmd:LINE`, the line of its heading.
 *
 * Every edit snapshots the files it touches into `<deck>/.deck_backups/<id>/`
 * first, checks the new outline against the expected slide order (and puts the
 * files back if it differs), and journals itself.
 *
 * The text manipulation is pure and exported for tests; the IO sits below it.
 * @module
 */
import { z } from "npm:zod@4";
import {
  audienceText,
  type DeckOutline,
  outlineDeck,
  parseQmd,
  type SlideInfo,
  type SourceLine,
} from "./outline.ts";

// ---------------------------------------------------------------- addresses

/** How a slide was addressed. */
export type Address =
  | { kind: "n"; n: number }
  | { kind: "loc"; file: string; line: number }
  | { kind: "title"; text: string };

/** `12` or `"12"` → counter number; `"glyc/_04.qmd:91"` → heading line; else title text. */
export function parseAddress(a: string | number): Address {
  if (typeof a === "number") return { kind: "n", n: a };
  const t = a.trim();
  if (/^\d+$/.test(t)) return { kind: "n", n: Number(t) };
  const loc = t.match(/^(.+\.(?:qmd|md)):(\d+)$/);
  if (loc) return { kind: "loc", file: loc[1], line: Number(loc[2]) };
  if (!t) throw new Error("empty slide address");
  return { kind: "title", text: t };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** What a slide is called: its title, or for an untitled slide its shown text. */
export function slideLabel(s: SlideInfo): string {
  if (s.title) return s.title;
  return audienceText(s).join(" ").replace(/\s+/g, " ").trim();
}

/** Front-matter facts that decide whether the counter can be computed. */
export interface CounterOpts {
  /** The deck has a title slide (front matter `title:`). */
  titleSlide: boolean;
  /** Per slide (same order): heading has `visibility="uncounted"`. */
  uncounted?: boolean[];
  /** Why the counter cannot be computed from the source, if it cannot. */
  unsafe?: string | null;
}

/** Counter number per slide (null = not shown, or not numbered). */
export function counterNumbers(
  slides: SlideInfo[],
  opts: CounterOpts,
): { numbers: Array<number | null>; total: number } {
  let c = opts.titleSlide ? 1 : 0;
  const numbers = slides.map((s, i) => {
    if (s.hidden || opts.uncounted?.[i]) return null;
    return ++c;
  });
  return { numbers, total: c };
}

/**
 * Reasons the source count would not match the built deck's counter: vertical
 * navigation, a slide level other than 2, or `---` slide breaks.
 */
export function counterUnsafe(
  frontMatter: string,
  slides: SlideInfo[],
): string | null {
  if (/navigation-mode:\s*["']?(vertical|grid)/.test(frontMatter)) {
    return "navigation-mode is vertical/grid (stacked slides)";
  }
  const lvl = frontMatter.match(/slide-level:\s*(\d)/);
  if (lvl && lvl[1] !== "2") return `slide-level is ${lvl[1]}, not 2`;
  const hr = slides.find((s) => s.body.some((l) => /^\s*---\s*$/.test(l)));
  if (hr) return `slide "${slideLabel(hr)}" contains a --- slide break`;
  return null;
}

function describe(s: SlideInfo, n: number | null): string {
  const label = slideLabel(s) || "(untitled, no text)";
  return `${n ?? "-"}  ${s.file}:${s.line}  ${label.slice(0, 70)}`;
}

/**
 * Index (into `slides`) of the one slide `addr` names. Throws, listing the
 * candidates, when none or several match.
 */
export function resolveSlide(
  slides: SlideInfo[],
  addr: Address,
  counter: CounterOpts,
): number {
  const { numbers } = counterNumbers(slides, counter);
  const list = (idx: number[]) =>
    idx.slice(0, 12).map((i) => "  " + describe(slides[i], numbers[i]))
      .join("\n") + (idx.length > 12 ? `\n  … ${idx.length - 12} more` : "");
  if (addr.kind === "n") {
    if (counter.unsafe) {
      throw new Error(
        `slide numbers cannot be computed from the source (${counter.unsafe}); address the slide by title`,
      );
    }
    const i = numbers.indexOf(addr.n);
    if (i < 0) {
      if (addr.n === 1 && counter.titleSlide) {
        throw new Error(
          "slide 1 is the title slide, made from the front matter",
        );
      }
      throw new Error(
        `no slide ${addr.n} (the deck has ${
          Math.max(
            0,
            ...numbers.map((x) => x ?? 0),
          )
        })`,
      );
    }
    return i;
  }
  if (addr.kind === "loc") {
    const i = slides.findIndex((s) =>
      s.file === addr.file && s.line === addr.line
    );
    if (i < 0) {
      const near = slides.map((_, j) => j).filter((j) =>
        slides[j].file === addr.file
      );
      throw new Error(
        `no slide heading at ${addr.file}:${addr.line}` +
          (near.length ? `; slides in that file:\n${list(near)}` : ""),
      );
    }
    return i;
  }
  const q = norm(addr.text);
  const hits = slides.map((_, i) => i).filter((i) => {
    const s = slides[i];
    return norm(slideLabel(s)).includes(q);
  });
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    const exact = hits.filter((i) => norm(slideLabel(slides[i])) === q);
    if (exact.length === 1) return exact[0];
    throw new Error(
      `"${addr.text}" matches ${hits.length} slides; use a longer part of the title, the number, or file:line:\n${
        list(hits)
      }`,
    );
  }
  throw new Error(
    `no slide matches "${addr.text}" (title, or shown text of an untitled slide)`,
  );
}

// ---------------------------------------------------------------- spans

/** Lines [start, end) of one slide in its file, 0-based; notes included. */
export interface Span {
  start: number;
  end: number;
}

const INCLUDE_RE = /^\s*\{\{<\s*include\s+([^\s>]+)\s*>\}\}\s*$/;

/**
 * The lines of the slide whose heading is on `heading` (1-based): up to the
 * next slide heading in the same file (`next`, 1-based, or null), or an
 * include line, or the end of the file. Trailing blank lines belong to it.
 */
export function slideSpan(
  lines: string[],
  heading: number,
  next: number | null,
): Span {
  const start = heading - 1;
  const limit = next ? next - 1 : lines.length;
  for (let i = start + 1; i < limit; i++) {
    if (INCLUDE_RE.test(lines[i])) return { start, end: i };
  }
  return { start, end: limit };
}

/** The text of a span without its trailing blank lines, ending in one newline. */
export function spanText(lines: string[], span: Span): string {
  const out = lines.slice(span.start, span.end);
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return out.join("\n") + "\n";
}

/** Lines of a block to insert: no leading or trailing blank lines. */
function blockLines(block: string): string[] {
  const ls = block.replace(/\r\n/g, "\n").split("\n");
  while (ls.length && ls[0].trim() === "") ls.shift();
  while (ls.length && ls[ls.length - 1].trim() === "") ls.pop();
  return ls;
}

/**
 * Insert `block` before line index `at` (0-based; `lines.length` = at the
 * end), with one blank line on each side. Returns the new lines and the
 * 1-based line of the block's first line.
 */
export function insertLines(
  lines: string[],
  at: number,
  block: string,
): { lines: string[]; line: number } {
  const b = blockLines(block);
  if (!b.length) throw new Error("nothing to insert: the slide text is empty");
  const head = lines.slice(0, at);
  const tail = lines.slice(at);
  if (head.length && head[head.length - 1].trim() !== "") head.push("");
  const line = head.length + 1;
  const mid = [...b];
  if (!tail.length) mid.push(""); // file ends with a newline
  else if (tail[0].trim() !== "") mid.push("");
  return { lines: [...head, ...mid, ...tail], line };
}

/** Remove a span; returns the new lines and the removed slide text. */
export function removeLines(
  lines: string[],
  span: Span,
): { lines: string[]; block: string } {
  return {
    lines: [...lines.slice(0, span.start), ...lines.slice(span.end)],
    block: spanText(lines, span),
  };
}

/**
 * Move a slide between (or within) files given as line arrays. `to.at` is a
 * line index in the target file *before* the removal. Returns the new line
 * arrays and the 1-based line of the moved heading.
 */
export function moveLines(
  files: Record<string, string[]>,
  from: { file: string; span: Span },
  to: { file: string; at: number },
): { files: Record<string, string[]>; line: number } {
  if (
    from.file === to.file && to.at > from.span.start && to.at < from.span.end
  ) {
    throw new Error("cannot move a slide inside itself");
  }
  const out = { ...files };
  const { lines: rest, block } = removeLines(files[from.file], from.span);
  out[from.file] = rest;
  let at = to.at;
  if (from.file === to.file && at >= from.span.end) {
    at -= from.span.end - from.span.start;
  }
  const ins = insertLines(out[to.file], at, block);
  out[to.file] = ins.lines;
  return { files: out, line: ins.line };
}

// ---------------------------------------------------------------- images

/** One image reference on a slide (outside the notes). */
export interface ImageRef {
  /** 0-based line index in the file. */
  line: number;
  /** Character offset of the path in that line. */
  col: number;
  path: string;
}

const DIV_OPEN_RE = /^(:{3,})\s*(\S.*)$/;
const DIV_CLOSE_RE = /^:{3,}\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/**
 * Image references in a slide's heading and body, in reading order: markdown
 * `![](path)`, `<img src="path">`, `background-image="path"`. Notes and code
 * fences are skipped; URLs and data URIs are left out.
 */
export function imageRefs(lines: string[], span: Span): ImageRef[] {
  const out: ImageRef[] = [];
  const stack: boolean[] = [];
  let fence: string | null = null;
  for (let i = span.start; i < span.end; i++) {
    const t = lines[i];
    if (fence) {
      if (t.trim().startsWith(fence)) fence = null;
      continue;
    }
    const f = t.match(FENCE_RE);
    if (f) {
      fence = f[1];
      continue;
    }
    if (DIV_CLOSE_RE.test(t) && stack.length) {
      stack.pop();
      continue;
    }
    const open = t.match(DIV_OPEN_RE);
    if (open) {
      stack.push(/^(\{\s*)?\.?notes\b/.test(open[2].trim()));
      continue;
    }
    if (stack.some((x) => x)) continue;
    const found: ImageRef[] = [];
    const pats: RegExp[] = [
      /!\[[^\]]*\]\(([^)\s]+)/g,
      /<img[^>]*\bsrc="([^"]+)"/g,
      /background-image="([^"]+)"/g,
    ];
    for (const re of pats) {
      for (const m of t.matchAll(re)) {
        const col = m.index! + m[0].lastIndexOf(m[1]);
        found.push({ line: i, col, path: m[1] });
      }
    }
    found.sort((a, b) => a.col - b.col);
    out.push(...found.filter((r) => !/^(https?:|data:)/.test(r.path)));
  }
  return out;
}

/** Replace one image reference with `path`. */
export function replaceRef(
  lines: string[],
  ref: ImageRef,
  path: string,
): string[] {
  const out = [...lines];
  const t = out[ref.line];
  if (t.slice(ref.col, ref.col + ref.path.length) !== ref.path) {
    throw new Error(
      `image reference moved: ${ref.path} not at line ${ref.line + 1}`,
    );
  }
  out[ref.line] = t.slice(0, ref.col) + path +
    t.slice(ref.col + ref.path.length);
  return out;
}

/**
 * New name for a replacement image: the old reference's folder and stem (a
 * previous `_<8 hex>` suffix dropped) + `_<hash8>` + the new file's extension.
 * A new name makes the browser load the new picture instead of its cache.
 */
export function hashedName(
  oldRef: string,
  newFile: string,
  hash: string,
): string {
  const slash = oldRef.lastIndexOf("/");
  const dir = slash < 0 ? "" : oldRef.slice(0, slash + 1);
  const base = oldRef.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(
    /_[0-9a-f]{8}$/,
    "",
  );
  const nb = newFile.split("/").pop() ?? newFile;
  const nd = nb.lastIndexOf(".");
  const ext = nd > 0
    ? nb.slice(nd).toLowerCase()
    : (dot > 0 ? base.slice(dot) : "");
  return `${dir}${stem}_${hash.slice(0, 8)}${ext}`;
}

// ---------------------------------------------------------------- parking

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `19 November 2026`. */
export function longDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Where a parked slide came from. */
export interface ParkMeta {
  date: Date;
  file: string;
  line: number;
  n: number | null;
  label: string;
  /** Label of the slide it followed, if any. */
  after: string | null;
  reason?: string;
}

function origin(m: ParkMeta): string {
  const n = m.n ? ` (slide ${m.n})` : "";
  const after = m.after ? `, after "${m.after}"` : ", first slide of the file";
  return `${m.file} line ${m.line}${n}${after}`;
}

/**
 * Text to append to the hold file. A `.qmd` hold gets the slide as is under an
 * HTML comment (the house convention); a `.md` build record gets a heading and
 * the slide in a fence, so its `##` does not become part of the record.
 */
export function holdEntry(
  kind: "qmd" | "md",
  block: string,
  m: ParkMeta,
): string {
  const why = m.reason ? ` ${m.reason.trim().replace(/\.?$/, ".")}` : "";
  if (kind === "qmd") {
    return [
      "<!--",
      `PARKED, ${longDate(m.date)}, from ${origin(m)}.${why}`,
      "-->",
      "",
      ...blockLines(block),
      "",
    ].join("\n");
  }
  const ticks = "`".repeat(
    Math.max(4, ...[...block.matchAll(/`{3,}/g)].map((x) => x[0].length + 1)),
  );
  return [
    `## Parked ${longDate(m.date)}: ${m.label.slice(0, 80)}`,
    "",
    `From ${origin(m)}.${why}`,
    "",
    ticks + "markdown",
    ...blockLines(block),
    ticks,
    "",
  ].join("\n");
}

/** Append an entry to a file's text with one blank line in between. */
export function appendEntry(existing: string, entry: string): string {
  if (!existing.trim()) return entry;
  return existing.replace(/\s*$/, "\n\n") + entry;
}

// ---------------------------------------------------------------- order check

/** Labels of the slides in a block of slide text. */
export function blockLabels(block: string): string[] {
  const lines: SourceLine[] = blockLines(block).map((text, i) => ({
    file: "block",
    line: i + 1,
    text,
  }));
  return parseQmd(lines).slides.map(slideLabel);
}

/** First difference between two label lists, or null. */
export function orderDiff(expected: string[], actual: string[]): string | null {
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    if (expected[i] !== actual[i]) {
      return `at position ${i + 1}: expected "${
        expected[i] ?? "(end)"
      }", found "${actual[i] ?? "(end)"}"`;
    }
  }
  return null;
}

// ================================================================ IO

const BACKUPS = ".deck_backups";

/** A snapshot of deck files taken before an edit. */
export interface Backup {
  id: string;
  at: string;
  method: string;
  note: string;
  files: Array<{ path: string; existed: boolean; bytes: number }>;
}

const pjoin = (dir: string, p: string) =>
  p.startsWith("/") ? p : `${dir.replace(/\/$/, "")}/${p}`;
const pdir = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Copy `files` (relative to the deck) into a new snapshot folder. */
export async function snapshot(
  dir: string,
  files: string[],
  method: string,
  note: string,
): Promise<Backup> {
  const at = new Date().toISOString();
  let id = `${at.replace(/[:.]/g, "-")}_${method}`;
  for (let k = 2; await exists(pjoin(dir, `${BACKUPS}/${id}`)); k++) {
    id = `${at.replace(/[:.]/g, "-")}_${method}_${k}`;
  }
  const root = pjoin(dir, `${BACKUPS}/${id}`);
  await Deno.mkdir(`${root}/files`, { recursive: true });
  const rec: Backup = { id, at, method, note, files: [] };
  for (const f of [...new Set(files)]) {
    const src = pjoin(dir, f);
    if (await exists(src)) {
      const dst = `${root}/files/${f}`;
      await Deno.mkdir(pdir(dst), { recursive: true });
      await Deno.copyFile(src, dst);
      rec.files.push({
        path: f,
        existed: true,
        bytes: (await Deno.stat(src)).size,
      });
    } else rec.files.push({ path: f, existed: false, bytes: 0 });
  }
  await Deno.writeTextFile(
    `${root}/manifest.json`,
    JSON.stringify(rec, null, 2) + "\n",
  );
  return rec;
}

/** Snapshots of this deck, oldest first. */
export async function listBackups(dir: string): Promise<Backup[]> {
  const out: Backup[] = [];
  try {
    for await (const e of Deno.readDir(pjoin(dir, BACKUPS))) {
      if (!e.isDirectory) continue;
      try {
        out.push(JSON.parse(
          await Deno.readTextFile(
            pjoin(dir, `${BACKUPS}/${e.name}/manifest.json`),
          ),
        ));
      } catch { /* not a snapshot */ }
    }
  } catch { /* no snapshots yet */ }
  return out.sort((a, b) => a.id < b.id ? -1 : 1);
}

/** The snapshot with this id (or the one whose id starts with it). */
export async function findBackup(dir: string, id: string): Promise<Backup> {
  const all = await listBackups(dir);
  const exact = all.find((b) => b.id === id);
  if (exact) return exact;
  const pre = all.filter((b) => b.id.startsWith(id));
  if (pre.length === 1) return pre[0];
  throw new Error(
    pre.length
      ? `"${id}" matches ${pre.length} snapshots: ${
        pre.map((b) => b.id).join(", ")
      }`
      : `no snapshot "${id}"; backup_list shows them`,
  );
}

/** Write a snapshot's files back (deleting files it recorded as absent). */
export async function putBack(dir: string, b: Backup): Promise<void> {
  for (const f of b.files) {
    const dst = pjoin(dir, f.path);
    if (f.existed) {
      await Deno.mkdir(pdir(dst), { recursive: true });
      await Deno.copyFile(
        pjoin(dir, `${BACKUPS}/${b.id}/files/${f.path}`),
        dst,
      );
    } else await Deno.remove(dst).catch(() => {});
  }
}

/** Outline plus what the counter needs. */
interface DeckState {
  outline: DeckOutline;
  counter: CounterOpts;
  numbers: Array<number | null>;
  /** File contents as line arrays, by deck-relative path. */
  text: Record<string, string[]>;
}

async function deckState(
  dir: string,
  main: string,
  checkedCount: number | null,
): Promise<DeckState> {
  const outline = outlineDeck(dir, main);
  const text: Record<string, string[]> = {};
  for (const f of outline.files) {
    text[f] = (await Deno.readTextFile(pjoin(dir, f))).split("\n");
  }
  const mainLines = text[main];
  let front = "";
  if (mainLines[0]?.trim() === "---") {
    const end = mainLines.findIndex((l, i) => i > 0 && l.trim() === "---");
    front = mainLines.slice(1, end < 0 ? undefined : end).join("\n");
  }
  const uncounted = outline.slides.map((s) =>
    /visibility\s*=\s*"?uncounted/.test(text[s.file]?.[s.line - 1] ?? "")
  );
  const counter: CounterOpts = {
    titleSlide: /^title:\s*\S/m.test(front),
    uncounted,
    unsafe: counterUnsafe(front, outline.slides),
  };
  const { numbers, total } = counterNumbers(outline.slides, counter);
  if (!counter.unsafe && checkedCount !== null && checkedCount !== total) {
    counter.unsafe =
      `the source gives ${total} slides but the last check saw ${checkedCount}; render + check again, or use the title`;
  }
  return { outline, counter, numbers, text };
}

function spanOf(st: DeckState, i: number): Span {
  const s = st.outline.slides[i];
  const next = st.outline.slides
    .filter((x) => x.file === s.file && x.line > s.line)
    .reduce<number | null>(
      (m, x) => m === null || x.line < m ? x.line : m,
      null,
    );
  return slideSpan(st.text[s.file], s.line, next);
}

/** What `slide_edit` changes; omitted fields stay as they are. */
export interface SlideEdit {
  title?: string;
  notes?: string;
  minutes?: number;
  maxHeight?: number;
  /** 1-based image index for maxHeight when the slide shows several. */
  which?: number;
}

/** `~1.5'` / `~45 s` for the notes. */
function timingText(minutes: number): string {
  return minutes < 1 ? `~${Math.round(minutes * 60)} s` : `~${minutes}'`;
}

/**
 * Apply a `SlideEdit` to the lines of one slide (`span` in `lines`). Keeps
 * the heading's `{…}` attributes, the notes' `Ref:` / `CHECK:` lines and the
 * timing unless `minutes` is given. Returns the new lines and what changed.
 */
export function editSlideLines(
  lines: string[],
  span: Span,
  e: SlideEdit,
  images: ImageRef[],
): { lines: string[]; changes: string[] } {
  const out = [...lines];
  const changes: string[] = [];
  if (e.title !== undefined) {
    const h = out[span.start];
    const m = h.match(/^(#{1,2}\s+)(.*?)(\s*\{[^}]*\})?\s*$/);
    if (!m) throw new Error(`line ${span.start + 1} is not a heading`);
    out[span.start] = `${m[1]}${e.title.trim()}${m[3] ?? ""}`;
    changes.push(`title "${m[2]}" → "${e.title.trim()}"`);
  }
  if (e.maxHeight !== undefined) {
    if (!images.length) throw new Error("maxHeight: the slide shows no image");
    if (images.length > 1 && e.which === undefined) {
      throw new Error(`the slide shows ${images.length} images; give which=`);
    }
    const ref = images[(e.which ?? 1) - 1];
    if (!ref) throw new Error(`no image ${e.which}`);
    const l = out[ref.line];
    const style =
      `{style="max-height: ${e.maxHeight}px; display: block; margin: 0 auto;"}`;
    const md = /(!\[[^\]]*\]\([^)]*\))(\{[^}]*\})?/;
    if (md.test(l)) out[ref.line] = l.replace(md, `$1${style}`);
    else if (/<img\b/.test(l)) {
      out[ref.line] = l.replace(/\sstyle="[^"]*"/, "").replace(
        /<img\b/,
        `<img style="max-height: ${e.maxHeight}px; display: block; margin: 0 auto;"`,
      );
    } else {throw new Error(
        `cannot set the size of the image on line ${ref.line + 1}`,
      );}
    changes.push(`max-height ${e.maxHeight}px on ${ref.path}`);
  }
  if (e.notes !== undefined || e.minutes !== undefined) {
    let a = -1, b = -1;
    for (let i = span.start; i < span.end; i++) {
      if (a < 0 && /^:{3,}\s*\{?\s*\.?notes\b/.test(out[i])) a = i;
      else if (a >= 0 && /^:{3,}\s*$/.test(out[i])) b = i;
    }
    const body = a >= 0 && b > a ? out.slice(a + 1, b) : [];
    const keep = body.filter((l) =>
      /^\s*(Ref(?:erence)?s?:|CHECK:|doi:)/i.test(l)
    );
    const text = body.filter((l) => !keep.includes(l)).join(" ").trim();
    const tm = text.match(/^~\s?[\d.]+\s?(?:'|s\b|min\b)\.?/);
    const timing = e.minutes !== undefined
      ? `${timingText(e.minutes)}.`
      : tm?.[0] ?? "";
    const said = e.notes !== undefined
      ? e.notes.trim()
      : text.slice(tm?.[0].length ?? 0).trim();
    const block = [
      "::: notes",
      [timing, said].filter(Boolean).join(" "),
      ...keep,
      ":::",
    ];
    if (a >= 0 && b > a) out.splice(a, b - a + 1, ...block);
    else {
      let at = span.end;
      while (at > span.start + 1 && out[at - 1].trim() === "") at--;
      out.splice(at, 0, "", ...block);
    }
    if (e.notes !== undefined) changes.push("notes rewritten");
    if (e.minutes !== undefined) {
      changes.push(`timing ${timingText(e.minutes)}`);
    }
  }
  if (!changes.length) {
    throw new Error(
      "nothing to change: give title, notes, minutes or maxHeight",
    );
  }
  return { lines: out, changes };
}

/** Minimal method context (the model's DeckContext satisfies it). */
export interface EditContext {
  globalArgs: { dir: string; main: string; assetsDir: string };
  logger: { info: (msg: string, props?: Record<string, unknown>) => void };
  writeResource: (
    spec: string,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<{ name: string }>;
  readResource?: (name: string) => Promise<Record<string, unknown> | null>;
}

type JournalFn = (
  ctx: EditContext,
  entry: { kind: "change"; text: string; slide?: string; ref?: string },
) => Promise<{ name: string }>;

async function loadState(ctx: EditContext): Promise<DeckState> {
  const chk = await ctx.readResource?.("check").catch(() => null) as
    | { slideCount?: number }
    | null;
  return deckState(
    ctx.globalArgs.dir,
    ctx.globalArgs.main,
    chk?.slideCount ?? null,
  );
}

function find(st: DeckState, a: string | number): number {
  return resolveSlide(st.outline.slides, parseAddress(a), st.counter);
}

/** Result of an edit, stored as the `edit` resource. */
export interface EditRecord {
  method: string;
  slide: string;
  file: string | null;
  line: number | null;
  n: number | null;
  backup: string;
  detail: string;
  at: string;
}

/**
 * Write the new file contents, re-read the outline and compare the slide order
 * with `expected`; on a mismatch put the snapshot back and throw.
 */
async function commit(
  ctx: EditContext,
  backup: Backup,
  files: Record<string, string>,
  expected: string[] | null,
): Promise<DeckState> {
  const dir = ctx.globalArgs.dir;
  for (const [f, t] of Object.entries(files)) {
    await Deno.mkdir(pdir(pjoin(dir, f)), { recursive: true });
    await Deno.writeTextFile(pjoin(dir, f), t);
  }
  const st = await deckState(dir, ctx.globalArgs.main, null);
  if (expected) {
    const diff = orderDiff(expected, st.outline.slides.map(slideLabel));
    if (diff) {
      await putBack(dir, backup);
      throw new Error(
        `the edit did not give the expected slide order (${diff}); files restored from ${backup.id}`,
      );
    }
  }
  return st;
}

async function finish(
  ctx: EditContext,
  journal: JournalFn,
  rec: Omit<EditRecord, "at">,
): Promise<{ dataHandles: Array<{ name: string }> }> {
  const full: EditRecord = { ...rec, at: new Date().toISOString() };
  const h = await ctx.writeResource("edit", "edit", { ...full });
  const j = await journal(ctx, {
    kind: "change",
    text: `${rec.method}: ${rec.detail}`,
    slide: rec.slide,
    ref: `backup ${rec.backup}`,
  });
  ctx.logger.info("{method} {where}; backup {backup}", {
    method: rec.method,
    where: rec.file
      ? `→ ${rec.file}:${rec.line ?? "?"}${rec.n ? ` (slide ${rec.n})` : ""}`
      : `${rec.n ? `slide ${rec.n} ` : ""}removed (not parked)`,
    backup: rec.backup,
  });
  return { dataHandles: [h, j] };
}

/** Where `after`/`before` puts new text: file and 0-based line index. */
function target(
  st: DeckState,
  args: { after?: string | number; before?: string | number },
): { file: string; at: number; index: number; label: string; where: string } {
  if ((args.after === undefined) === (args.before === undefined)) {
    throw new Error("give exactly one of after or before");
  }
  const i = find(st, (args.after ?? args.before)!);
  const s = st.outline.slides[i];
  const span = spanOf(st, i);
  const label = slideLabel(s);
  return args.after !== undefined
    ? {
      file: s.file,
      at: span.end,
      index: i + 1,
      label,
      where: `after "${label}"`,
    }
    : {
      file: s.file,
      at: span.start,
      index: i,
      label,
      where: `before "${label}"`,
    };
}

const joinLines = (ls: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(ls).map(([f, l]) => [f, l.join("\n")]));

const AddressSchema = z.union([z.string(), z.number()]);
const addrDoc =
  "Slide: part of its title (or of the shown text of an untitled slide), its number in the built deck, or file.qmd:LINE";

/** Resources the edit methods write. */
export const editResources = {
  edit: {
    description:
      "The last slide edit: method, slide, new location (file, line, number), snapshot id",
    schema: z.object({
      method: z.string(),
      slide: z.string(),
      file: z.string().nullable(),
      line: z.number().nullable(),
      n: z.number().nullable(),
      backup: z.string(),
      detail: z.string(),
      at: z.string(),
    }),
    lifetime: "infinite" as const,
    garbageCollection: 50,
  },
  backups: {
    description: "Snapshots of deck files taken before each edit",
    schema: z.object({
      dir: z.string(),
      backups: z.array(z.object({
        id: z.string(),
        at: z.string(),
        method: z.string(),
        note: z.string(),
        files: z.array(z.object({
          path: z.string(),
          existed: z.boolean(),
          bytes: z.number(),
        })),
      })),
    }),
    lifetime: "infinite" as const,
    garbageCollection: 10,
  },
};

/** The slide-edit methods, for spreading into the model's `methods`. */
export function editMethods(journal: JournalFn) {
  return {
    slide_insert: {
      description:
        "Insert slide text (from a .qmd file or inline) before or after a slide addressed by title, number or file:line. Snapshots first, journals itself",
      arguments: z.object({
        after: AddressSchema.optional().describe(addrDoc),
        before: AddressSchema.optional().describe(addrDoc),
        file: z.string().optional().describe(
          "A .qmd holding the slide(s) to insert (absolute, or relative to dir)",
        ),
        text: z.string().optional().describe(
          "The slide markdown, instead of file",
        ),
        reason: z.string().optional().describe("Why, for the journal"),
      }),
      execute: async (
        args: {
          after?: string | number;
          before?: string | number;
          file?: string;
          text?: string;
          reason?: string;
        },
        ctx: EditContext,
      ) => {
        if ((args.file === undefined) === (args.text === undefined)) {
          throw new Error("give exactly one of file or text");
        }
        const block = args.text ??
          await Deno.readTextFile(pjoin(ctx.globalArgs.dir, args.file!));
        const first = blockLines(block)[0] ?? "";
        if (!/^#{1,2}\s/.test(first)) {
          throw new Error(
            `the slide text must start with a # or ## heading; it starts with "${
              first.slice(0, 60)
            }"`,
          );
        }
        const labels = blockLabels(block);
        const st = await loadState(ctx);
        const t = target(st, args);
        const backup = await snapshot(
          ctx.globalArgs.dir,
          [t.file],
          "slide_insert",
          `before inserting "${labels[0]}" ${t.where}`,
        );
        const ins = insertLines(st.text[t.file], t.at, block);
        const before = st.outline.slides.map(slideLabel);
        const expected = [
          ...before.slice(0, t.index),
          ...labels,
          ...before.slice(t.index),
        ];
        const after = await commit(
          ctx,
          backup,
          { [t.file]: ins.lines.join("\n") },
          expected,
        );
        return finish(ctx, journal, {
          method: "slide_insert",
          slide: labels[0],
          file: t.file,
          line: ins.line,
          n: after.numbers[t.index],
          backup: backup.id,
          detail: `inserted ${labels.length} slide(s) ${t.where} in ${t.file}${
            args.reason ? `: ${args.reason}` : ""
          }`,
        });
      },
    },

    slide_move: {
      description:
        "Move a slide (with its notes) before or after another slide, also into another section file. Snapshots first, journals itself",
      arguments: z.object({
        slide: AddressSchema.describe(addrDoc),
        after: AddressSchema.optional().describe(addrDoc),
        before: AddressSchema.optional().describe(addrDoc),
        reason: z.string().optional(),
      }),
      execute: async (
        args: {
          slide: string | number;
          after?: string | number;
          before?: string | number;
          reason?: string;
        },
        ctx: EditContext,
      ) => {
        const st = await loadState(ctx);
        const i = find(st, args.slide);
        const s = st.outline.slides[i];
        const t = target(st, args);
        if (t.index === i || t.index === i + 1) {
          throw new Error(`"${slideLabel(s)}" is already ${t.where}`);
        }
        const backup = await snapshot(
          ctx.globalArgs.dir,
          [s.file, t.file],
          "slide_move",
          `before moving "${
            slideLabel(s)
          }" from ${s.file}:${s.line} ${t.where}`,
        );
        const mv = moveLines(st.text, { file: s.file, span: spanOf(st, i) }, {
          file: t.file,
          at: t.at,
        });
        const labels = st.outline.slides.map(slideLabel);
        const expected = labels.filter((_, k) => k !== i);
        const dest = t.index > i ? t.index - 1 : t.index;
        expected.splice(dest, 0, labels[i]);
        const changed = [...new Set([s.file, t.file])];
        const after = await commit(
          ctx,
          backup,
          joinLines(Object.fromEntries(changed.map((f) => [f, mv.files[f]]))),
          expected,
        );
        return finish(ctx, journal, {
          method: "slide_move",
          slide: slideLabel(s),
          file: t.file,
          line: mv.line,
          n: after.numbers[dest],
          backup: backup.id,
          detail:
            `moved from ${s.file}:${s.line} to ${t.file}:${mv.line}, ${t.where}${
              args.reason ? `: ${args.reason}` : ""
            }`,
        });
      },
    },

    slide_delete: {
      description:
        "Delete a slide. park=true (default) appends it, with date and original position, to the deck's _hold*.qmd if it has one, else to HOLD_<deck>.md. Snapshots first, journals itself",
      arguments: z.object({
        slide: AddressSchema.describe(addrDoc),
        park: z.boolean().default(true),
        reason: z.string().optional(),
      }),
      execute: async (
        args: { slide: string | number; park?: boolean; reason?: string },
        ctx: EditContext,
      ) => {
        const dir = ctx.globalArgs.dir;
        const st = await loadState(ctx);
        const i = find(st, args.slide);
        const s = st.outline.slides[i];
        const label = slideLabel(s);
        const hold = args.park !== false
          ? await holdFile(dir, st.outline, s.file)
          : null;
        const backup = await snapshot(
          dir,
          hold ? [s.file, hold] : [s.file],
          "slide_delete",
          `before deleting "${label}" from ${s.file}:${s.line}`,
        );
        const rm = removeLines(st.text[s.file], spanOf(st, i));
        const files: Record<string, string> = { [s.file]: rm.lines.join("\n") };
        let holdLine: number | null = null;
        if (hold) {
          const cur = await Deno.readTextFile(pjoin(dir, hold)).catch(() => "");
          const prev = st.outline.slides[i - 1];
          const entry = holdEntry(
            hold.endsWith(".qmd") ? "qmd" : "md",
            rm.block,
            {
              date: new Date(),
              file: s.file,
              line: s.line,
              n: st.numbers[i],
              label,
              after: prev ? slideLabel(prev) : null,
              reason: args.reason,
            },
          );
          const next = appendEntry(cur, entry);
          holdLine =
            next.slice(0, next.length - entry.length).split("\n").length;
          files[hold] = next;
        }
        const expected = st.outline.slides.map(slideLabel).filter((_, k) =>
          k !== i
        );
        await commit(ctx, backup, files, expected);
        return finish(ctx, journal, {
          method: "slide_delete",
          slide: label,
          file: hold,
          line: holdLine,
          n: null,
          backup: backup.id,
          detail: `deleted from ${s.file}:${s.line}${
            st.numbers[i] ? ` (slide ${st.numbers[i]})` : ""
          }${hold ? `, parked in ${hold}` : ", not parked"}${
            args.reason ? `: ${args.reason}` : ""
          }`,
        });
      },
    },

    slide_replace_image: {
      description:
        "Replace an image on a slide: copies the new file next to the old one as <name>_<8 hex>.<ext> (a new name, so the browser does not show the cached picture), rewrites the reference, keeps the old file",
      arguments: z.object({
        slide: AddressSchema.describe(addrDoc),
        image: z.string().describe(
          "New image file (absolute, or relative to dir)",
        ),
        which: z.number().int().positive().optional().describe(
          "1-based index when the slide shows several images (reading order)",
        ),
        reason: z.string().optional(),
      }),
      execute: async (
        args: {
          slide: string | number;
          image: string;
          which?: number;
          reason?: string;
        },
        ctx: EditContext,
      ) => {
        const dir = ctx.globalArgs.dir;
        const st = await loadState(ctx);
        const i = find(st, args.slide);
        const s = st.outline.slides[i];
        const refs = imageRefs(st.text[s.file], spanOf(st, i));
        if (!refs.length) throw new Error(`"${slideLabel(s)}" shows no image`);
        const listing = refs.map((r, k) => `  ${k + 1}. ${r.path}`).join("\n");
        if (refs.length > 1 && args.which === undefined) {
          throw new Error(
            `the slide shows ${refs.length} images; give which=:\n${listing}`,
          );
        }
        const ref = refs[(args.which ?? 1) - 1];
        if (!ref) {
          throw new Error(
            `no image ${args.which}; the slide shows:\n${listing}`,
          );
        }
        const src = pjoin(dir, args.image);
        const bytes = await Deno.readFile(src);
        const hash = [
          ...new Uint8Array(
            await crypto.subtle.digest("SHA-256", bytes as BufferSource),
          ),
        ].map((b) => b.toString(16).padStart(2, "0")).join("");
        let rel = hashedName(ref.path, args.image, hash);
        const assets = ctx.globalArgs.assetsDir.replace(/\/$/, "");
        if (rel.startsWith("/") || rel.startsWith("..") || !rel.includes("/")) {
          rel = `${assets}/${rel.split("/").pop()}`;
        }
        if (rel === ref.path) {
          throw new Error(`${ref.path} already has this content`);
        }
        const backup = await snapshot(
          dir,
          [s.file, rel],
          "slide_replace_image",
          `before replacing ${ref.path} on "${slideLabel(s)}"`,
        );
        await Deno.mkdir(pdir(pjoin(dir, rel)), { recursive: true });
        await Deno.writeFile(pjoin(dir, rel), bytes);
        const lines = replaceRef(st.text[s.file], ref, rel);
        await commit(
          ctx,
          backup,
          { [s.file]: lines.join("\n") },
          st.outline.slides.map(slideLabel),
        );
        return finish(ctx, journal, {
          method: "slide_replace_image",
          slide: slideLabel(s),
          file: s.file,
          line: ref.line + 1,
          n: st.numbers[i],
          backup: backup.id,
          detail: `${ref.path} → ${rel} (from ${args.image}; old file kept)${
            args.reason ? `: ${args.reason}` : ""
          }`,
        });
      },
    },

    slide_edit: {
      description:
        "Change one slide in place: title (heading attributes kept), speaker notes (timing, Ref: and CHECK: lines kept), minutes (the notes timing) and/or an image's maxHeight (e.g. the value `check` suggests to clear the logo). Snapshot first; journals itself",
      arguments: z.object({
        slide: AddressSchema.describe(addrDoc),
        title: z.string().optional(),
        notes: z.string().optional().describe(
          "What you will say; replaces the spoken part of the notes",
        ),
        minutes: z.number().positive().optional(),
        maxHeight: z.number().int().positive().optional().describe(
          "Image max-height in px (slide units)",
        ),
        which: z.number().int().positive().optional().describe(
          "1-based image index for maxHeight when the slide shows several",
        ),
        reason: z.string().optional(),
      }),
      execute: async (
        args: SlideEdit & { slide: string | number; reason?: string },
        ctx: EditContext,
      ) => {
        const st = await loadState(ctx);
        const i = find(st, args.slide);
        const s = st.outline.slides[i];
        const span = spanOf(st, i);
        const r = editSlideLines(
          st.text[s.file],
          span,
          args,
          imageRefs(st.text[s.file], span),
        );
        const backup = await snapshot(
          ctx.globalArgs.dir,
          [s.file],
          "slide_edit",
          `before editing "${slideLabel(s)}"`,
        );
        const expected = st.outline.slides.map(slideLabel);
        if (args.title !== undefined) expected[i] = args.title.trim();
        await commit(ctx, backup, { [s.file]: r.lines.join("\n") }, expected);
        return finish(ctx, journal, {
          method: "slide_edit",
          slide: args.title?.trim() ?? slideLabel(s),
          file: s.file,
          line: s.line,
          n: st.numbers[i],
          backup: backup.id,
          detail: `${r.changes.join("; ")}${
            args.reason ? `: ${args.reason}` : ""
          }`,
        });
      },
    },

    backup_list: {
      description:
        "List the snapshots the edit methods took (in <deck>/.deck_backups), oldest first",
      arguments: z.object({}),
      execute: async (_args: Record<string, never>, ctx: EditContext) => {
        const backups = await listBackups(ctx.globalArgs.dir);
        for (const b of backups) {
          ctx.logger.info("{id}  {note}  [{files}]", {
            id: b.id,
            note: b.note,
            files: b.files.map((f) => f.path).join(", "),
          });
        }
        const h = await ctx.writeResource("backups", "backups", {
          dir: pjoin(ctx.globalArgs.dir, BACKUPS),
          backups,
        });
        return { dataHandles: [h] };
      },
    },

    restore: {
      description:
        "Put back the files of a snapshot (id or unique id prefix from backup_list); snapshots the current state first, so a restore can be undone",
      arguments: z.object({ id: z.string() }),
      execute: async (args: { id: string }, ctx: EditContext) => {
        const dir = ctx.globalArgs.dir;
        const b = await findBackup(dir, args.id);
        const now = await snapshot(
          dir,
          b.files.map((f) => f.path),
          "restore",
          `before restoring ${b.id}`,
        );
        await putBack(dir, b);
        return finish(ctx, journal, {
          method: "restore",
          slide: "",
          file: b.files[0]?.path ?? null,
          line: null,
          n: null,
          backup: now.id,
          detail: `restored ${
            b.files.map((f) => f.path).join(", ")
          } from ${b.id} (${b.note})`,
        });
      },
    },
  };
}

/**
 * Where parked slides go: a `_hold*.qmd` next to the deck's files (the slide's
 * own folder first) that is not itself included, else `HOLD_<main>.md`.
 */
export async function holdFile(
  dir: string,
  outline: DeckOutline,
  slideFile: string,
): Promise<string> {
  const dirs = [...new Set([pdir(slideFile), ...outline.files.map(pdir)])];
  for (const d of dirs) {
    const found: string[] = [];
    try {
      for await (const e of Deno.readDir(d ? pjoin(dir, d) : dir)) {
        if (e.isFile && /^_hold.*\.qmd$/.test(e.name)) {
          const rel = d ? `${d}/${e.name}` : e.name;
          if (!outline.files.includes(rel)) found.push(rel);
        }
      }
    } catch { /* folder gone */ }
    if (found.length) return found.sort()[0];
  }
  const stem = (outline.main.split("/").pop() ?? "deck").replace(
    /\.[^.]+$/,
    "",
  );
  return `HOLD_${stem}.md`;
}
