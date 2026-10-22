/**
 * Static outline of a Quarto reveal.js deck: follows the `{{< include >}}`
 * tree from the main .qmd and reports every slide without rendering — titles,
 * hidden slides, fragments, speaker-notes coverage, the `~1.5'` timing budget,
 * `CHECK:` markers, images (and which are missing), `.src` lines and DOIs.
 *
 * Pure parsing lives in `parseQmd`/`outlineFromSlides`; `outlineDeck` adds the
 * file IO (include resolution, image existence).
 * @module
 */

/** One slide as written in the source. */
export interface SlideInfo {
  /** 1-based position among all slides in source order (hidden included). */
  n: number;
  /** 1 = section slide (`#`), 2 = slide (`##`). */
  level: 1 | 2;
  title: string;
  /** Classes from the heading attributes, e.g. `section`, `statement`. */
  classes: string[];
  hidden: boolean;
  /** File the slide is written in, relative to the deck dir. */
  file: string;
  /** 1-based line of the heading in `file`. */
  line: number;
  fragments: number;
  hasNotes: boolean;
  /** Minutes parsed from the notes (`~1.5'`, `~45 s`), null when absent. */
  minutes: number | null;
  images: string[];
  src: string[];
  dois: string[];
  checks: string[];
}

/** Whole-deck outline. */
export interface DeckOutline {
  main: string;
  title: string | null;
  files: string[];
  slides: SlideInfo[];
  visibleSlides: number;
  hiddenSlides: number;
  notesCoverage: number;
  timedSlides: number;
  untimedVisible: number[];
  minutesPlanned: number;
  slotMinutes: number | null;
  missingImages: Array<{ slide: number; path: string }>;
  checks: Array<{ slide: number | null; file: string; text: string }>;
  dois: string[];
  missingIncludes: string[];
}

/** A source line tagged with the file it came from (after include expansion). */
export interface SourceLine {
  file: string;
  line: number;
  text: string;
}

const INCLUDE_RE = /^\s*\{\{<\s*include\s+([^\s>]+)\s*>\}\}\s*$/;
const HEADING_RE = /^(#{1,2})\s+(.*?)\s*$/;
const ATTR_RE = /\{([^{}]*)\}\s*$/;
const DIV_OPEN_RE = /^(:{3,})\s*(\S.*)$/;
const DIV_CLOSE_RE = /^:{3,}\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/** Parse minutes from a notes block: `~1.5'`, `~2'`, `~45 s`, `~10 s`. */
export function parseMinutes(notes: string): number | null {
  const min = notes.match(/~\s*(\d+(?:[.,]\d+)?)\s*['′]/);
  if (min) return Number(min[1].replace(",", "."));
  const sec = notes.match(/~\s*(\d+(?:[.,]\d+)?)\s*s(?:ec)?\b/);
  if (sec) return Number(sec[1].replace(",", ".")) / 60;
  return null;
}

/** Trim sentence punctuation and unbalanced closing parentheses off a DOI. */
export function cleanDoi(raw: string): string {
  const count = (s: string, c: string) => s.split(c).length - 1;
  let doi = raw;
  for (;;) {
    if (doi.endsWith(".")) doi = doi.slice(0, -1);
    else if (doi.endsWith(")") && count(doi, ")") > count(doi, "(")) {
      doi = doi.slice(0, -1);
    } else return doi;
  }
}

/** Split a heading into title, classes and hidden flag. */
export function parseHeading(
  raw: string,
): { title: string; classes: string[]; hidden: boolean } {
  let title = raw;
  let attrs = "";
  const m = raw.match(ATTR_RE);
  if (m) {
    attrs = m[1];
    title = raw.slice(0, m.index).trim();
  }
  const classes = [...attrs.matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
  const hidden = /visibility\s*=\s*"?hidden"?/.test(attrs);
  return { title: title.trim(), classes, hidden };
}

/** Image paths referenced by a line (markdown, <img>, background-image). */
export function imagesInLine(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) out.push(m[1]);
  for (const m of text.matchAll(/<img[^>]*\bsrc="([^"]+)"/g)) out.push(m[1]);
  for (const m of text.matchAll(/background-image="([^"]+)"/g)) out.push(m[1]);
  return out.filter((p) => !/^(https?:|data:)/.test(p));
}

/**
 * Turn expanded source lines into slides. Front matter, code fences and the
 * contents of `::: notes` blocks are handled so headings inside them do not
 * start slides.
 */
export function parseQmd(lines: SourceLine[]): {
  slides: SlideInfo[];
  title: string | null;
  orphanChecks: Array<{ file: string; text: string }>;
} {
  const slides: SlideInfo[] = [];
  const orphanChecks: Array<{ file: string; text: string }> = [];
  let title: string | null = null;
  let i = 0;
  // front matter of the main document
  if (lines[0]?.text.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i].text.trim() !== "---") {
      const t = lines[i].text.match(/^title:\s*"?(.*?)"?\s*$/);
      if (t && title === null) title = t[1];
      i++;
    }
    i++;
  }
  let cur: SlideInfo | null = null;
  let fence: string | null = null;
  const divStack: boolean[] = []; // true = notes div
  let notesBuf: string[] = [];

  const inNotes = () => divStack.some((x) => x);

  for (; i < lines.length; i++) {
    const { text, file, line } = lines[i];
    if (fence) {
      if (text.trim().startsWith(fence)) fence = null;
      continue;
    }
    const f = text.match(FENCE_RE);
    if (f) {
      fence = f[1];
      continue;
    }
    if (DIV_CLOSE_RE.test(text) && divStack.length) {
      const wasNotes = divStack.pop();
      if (wasNotes && !inNotes() && cur) {
        const notes = notesBuf.join("\n");
        cur.hasNotes = true;
        if (cur.minutes === null) cur.minutes = parseMinutes(notes);
        for (
          const d of notes.matchAll(
            /(?:doi:\s*|doi\.org\/)(10\.\d{4,}\/[^\s,;]+)/gi,
          )
        ) {
          const doi = cleanDoi(d[1]);
          if (!cur.dois.includes(doi)) cur.dois.push(doi);
        }
        notesBuf = [];
      }
      continue;
    }
    const open = text.match(DIV_OPEN_RE);
    if (open) {
      const isNotes = /^(\{\s*)?\.?notes\b/.test(open[2].trim());
      if (cur && !isNotes && !inNotes()) {
        cur.fragments += (open[2].match(/\.fragment\b/g) ?? []).length;
      }
      divStack.push(isNotes);
      continue;
    }
    const check = text.match(/\bCHECK:\s*(.*)$/);
    if (check) {
      if (cur) cur.checks.push(check[1].trim());
      else orphanChecks.push({ file, text: check[1].trim() });
    }
    if (inNotes()) {
      notesBuf.push(text);
      continue;
    }
    const h = text.match(HEADING_RE);
    if (h && divStack.length === 0) {
      const { title: t, classes, hidden } = parseHeading(h[2]);
      cur = {
        n: slides.length + 1,
        level: h[1].length as 1 | 2,
        title: t,
        classes,
        hidden,
        file,
        line,
        fragments: 0,
        hasNotes: false,
        minutes: null,
        images: [],
        src: [],
        dois: [],
        checks: [],
      };
      slides.push(cur);
      continue;
    }
    if (!cur) continue;
    cur.fragments += (text.match(/\.fragment\b/g) ?? []).length;
    cur.images.push(...imagesInLine(text));
    for (const s of text.matchAll(/\[([^\]]+)\]\{\.src\b[^}]*\}/g)) {
      cur.src.push(s[1]);
    }
  }
  return { slides, title, orphanChecks };
}

/** Summarise parsed slides into a deck outline (no IO). */
export function outlineFromSlides(
  main: string,
  files: string[],
  parsed: ReturnType<typeof parseQmd>,
  opts: {
    slotMinutes?: number | null;
    exists?: (path: string) => boolean;
    missingIncludes?: string[];
  } = {},
): DeckOutline {
  const { slides } = parsed;
  const visible = slides.filter((s) => !s.hidden);
  const timed = visible.filter((s) => s.minutes !== null);
  const exists = opts.exists ?? (() => true);
  const missingImages: Array<{ slide: number; path: string }> = [];
  for (const s of slides) {
    for (const p of s.images) {
      if (!exists(p)) missingImages.push({ slide: s.n, path: p });
    }
  }
  const checks = [
    ...parsed.orphanChecks.map((c) => ({ slide: null, ...c })),
    ...slides.flatMap((s) =>
      s.checks.map((text) => ({ slide: s.n, file: s.file, text }))
    ),
  ];
  const minutes = timed.reduce((a, s) => a + (s.minutes ?? 0), 0);
  return {
    main,
    title: parsed.title,
    files,
    slides,
    visibleSlides: visible.length,
    hiddenSlides: slides.length - visible.length,
    notesCoverage: visible.length
      ? Math.round(
        100 * visible.filter((s) => s.hasNotes).length / visible.length,
      ) / 100
      : 0,
    timedSlides: timed.length,
    untimedVisible: visible
      .filter((s) => s.minutes === null && s.level === 2)
      .map((s) => s.n),
    minutesPlanned: Math.round(minutes * 10) / 10,
    slotMinutes: opts.slotMinutes ?? null,
    missingImages,
    checks,
    dois: [...new Set(slides.flatMap((s) => s.dois))],
    missingIncludes: opts.missingIncludes ?? [],
  };
}

function join(dir: string, p: string): string {
  if (p.startsWith("/")) return p;
  return `${dir.replace(/\/$/, "")}/${p}`;
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function fileExists(p: string): boolean {
  try {
    return Deno.statSync(p).isFile;
  } catch {
    return false;
  }
}

/**
 * Expand includes starting at `main` (relative to `dir`). Include paths are
 * tried relative to the including file first, then to the deck dir.
 */
export function expandIncludes(
  dir: string,
  main: string,
): { lines: SourceLine[]; files: string[]; missing: string[] } {
  const lines: SourceLine[] = [];
  const files: string[] = [];
  const missing: string[] = [];
  const visit = (rel: string, depth: number) => {
    if (depth > 20) throw new Error(`include depth > 20 at ${rel}`);
    files.push(rel);
    const text = Deno.readTextFileSync(join(dir, rel));
    text.split(/\r?\n/).forEach((t, idx) => {
      const inc = t.match(INCLUDE_RE);
      if (inc) {
        const cands = [join(dirname(rel), inc[1]).replace(/^\//, ""), inc[1]];
        const hit = cands.find((c) => fileExists(join(dir, c)));
        if (hit) visit(hit, depth + 1);
        else missing.push(inc[1]);
        return;
      }
      lines.push({ file: rel, line: idx + 1, text: t });
    });
  };
  visit(main, 0);
  return { lines, files, missing };
}

/** Outline a deck on disk. */
export function outlineDeck(
  dir: string,
  main: string,
  slotMinutes?: number | null,
): DeckOutline {
  const { lines, files, missing } = expandIncludes(dir, main);
  const parsed = parseQmd(lines);
  return outlineFromSlides(main, files, parsed, {
    slotMinutes,
    exists: (p) => fileExists(join(dir, p)),
    missingIncludes: missing,
  });
}
