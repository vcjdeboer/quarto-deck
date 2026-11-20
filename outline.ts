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
  /** Fragments that drive an animation (`.fragment .step`), not text builds. */
  steps: number;
  /** Notes cite a reference (`Ref:` line or a DOI). */
  hasRef: boolean;
  hasNotes: boolean;
  /** Minutes parsed from the notes (`~1.5'`, `~45 s`), null when absent. */
  minutes: number | null;
  images: string[];
  src: string[];
  /** `Ref:` lines of the speaker notes. */
  refLines: string[];
  dois: string[];
  checks: string[];
  /** Slide source lines outside the notes block: what the audience sees. */
  body: string[];
  /** 1-based line in `file` of each entry of `body`. */
  bodyLines: number[];
  /** Classes of the fenced divs on the slide (`::: {.lo}` gives `lo`). */
  divClasses: string[];
  /** Rule ids accepted for this slide: `lint-ignore="two-images,scaffolding"`. */
  ignore: string[];
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
  /** House-style findings on visible slides (minus the suppressed ones). */
  styleIssues: StyleIssue[];
  /** Findings accepted per slide with `lint-ignore`; counted, not hidden. */
  suppressed: StyleIssue[];
  /** Opening vs closing learning outcomes and which slides cover each. */
  outcomes: OutcomeReport | null;
  /** Where the time goes: per section share of the slot and longest slides. */
  cut: CutView;
  /** Planned minutes per `#` section (slides before the first section: "Opening"). */
  sections: SectionTime[];
}

/** Time planned in one section. */
export interface SectionTime {
  title: string;
  /** Slide number of the section heading (null for the opening). */
  slide: number | null;
  slides: number;
  minutes: number;
}

/** Rule families (the `rule` field); kept stable for stored outlines. */
export type RuleFamily =
  | "references"
  | "titles"
  | "conclusions"
  | "caveats"
  | "one-figure"
  | "one-source"
  | "no-builds"
  | "notes"
  | "timing"
  | "doi"
  | "narration"
  | "svg"
  | "outcomes"
  | "lint";

/**
 * Every lint finding has a stable short id, usable in
 * `lint-ignore="id,id"` on the slide heading. A family name (e.g.
 * `narration`) accepts every id in that family.
 */
export const LINT_RULES = {
  "two-images": {
    family: "one-figure",
    level: "rule",
    what: "more than one image on a paper slide",
  },
  "two-sources": {
    family: "one-source",
    level: "rule",
    what: "more than one .src line",
  },
  "builds": {
    family: "no-builds",
    level: "rule",
    what:
      "click builds on a paper slide (.fragment .step animation steps are fine)",
  },
  "no-notes": { family: "notes", level: "rule", what: "no speaker notes" },
  "no-timing": {
    family: "timing",
    level: "rule",
    what: "notes that do not start with ~1.5' / ~45 s",
  },
  "src-incomplete": {
    family: "references",
    level: "rule",
    what:
      "a .src line without author, year, journal and volume:page (e.g. 'Hirschey et al. 2010, Nature 464:121')",
  },
  "author-not-bold": {
    family: "references",
    level: "rule",
    what:
      "the lecturer's name (highlightAuthor) in a .src or Ref: line without bold",
  },
  "no-ref": {
    family: "doi",
    level: "hint",
    what: "a paper slide whose notes cite no reference",
  },
  "first-person": {
    family: "narration",
    level: "rule",
    what: "we, us, our, let's in shown text",
  },
  "occasion": {
    family: "narration",
    level: "rule",
    what: "today, this lecture, the whole talk, next slide",
  },
  "scaffolding": {
    family: "narration",
    level: "rule",
    what: "timetable or scaffolding words: slot, rung, before the break",
  },
  "open-question": {
    family: "narration",
    level: "rule",
    what: "shown text that opens with Open question:",
  },
  "scaffold-title": {
    family: "narration",
    level: "rule",
    what:
      "a title that opens with Approach:, The control:, Recap, Key figure …",
  },
  "topic-title": {
    family: "titles",
    level: "hint",
    what:
      "a bare topic word as title (Results, Background, Introduction …): state the finding or name what the slide shows",
  },
  "conclusion-table": {
    family: "conclusions",
    level: "rule",
    what:
      "a conclusions / take-home slide written as a table: use a few bullets tied to the slides",
  },
  "conclusion-long": {
    family: "conclusions",
    level: "hint",
    what: "a conclusions slide with more than five bullets",
  },
  "caveat-line": {
    family: "caveats",
    level: "hint",
    what:
      "shown text that opens with Caveat:, Limitation:, Note: — keep it only if the talk raises it",
  },
  "spoken-line": {
    family: "narration",
    level: "hint",
    what: "a free-standing sentence of six words or more beside a figure",
  },
  "svg-blank-line": {
    family: "svg",
    level: "rule",
    what:
      "a blank line inside an inline <svg>: Quarto ends the HTML block there and the slide breaks",
  },
  "svg-small-text": {
    family: "svg",
    level: "hint",
    what: "SVG text with font-size below 16",
  },
  "lo-mismatch": {
    family: "outcomes",
    level: "rule",
    what: "opening and closing learning outcomes differ",
  },
  "lo-uncovered": {
    family: "outcomes",
    level: "hint",
    what: "a learning outcome whose key terms appear on no slide",
  },
  "unknown-ignore": {
    family: "lint",
    level: "hint",
    what: "lint-ignore names an id that does not exist",
  },
} as const satisfies Record<
  string,
  { family: RuleFamily; level: "rule" | "hint"; what: string }
>;

/** Stable id of a lint finding. */
export type RuleId = keyof typeof LINT_RULES;

/** A slide that breaks a house-style rule. */
export interface StyleIssue {
  /** Source index of the slide (`SlideInfo.n`). */
  slide: number;
  /**
   * Number in the slide counter (title slide = 1, as slide_map numbers them);
   * null for a hidden slide. Set by `lintDeck`.
   */
  shown?: number | null;
  title: string;
  /** Stable short id (see `LINT_RULES`), the name used in `lint-ignore`. */
  id: RuleId;
  /** Rule family. */
  rule: RuleFamily;
  /** rule = breaks the house style; hint = worth fixing, often fine. */
  level: "rule" | "hint";
  message: string;
  /** Where to look: the slide heading, or the exact line for SVG findings. */
  file: string;
  line: number;
}

/** One numbered learning outcome and the slides that cover it. */
export interface OutcomeItem {
  n: number;
  text: string;
  /** Bold key terms, each with the visible slides whose shown text has it. */
  terms: Array<{ term: string; slides: number[] }>;
  /** Union of the term slides. */
  slides: number[];
}

/** Learning-outcome check. */
export interface OutcomeReport {
  opening: number | null;
  closing: number | null;
  /** Both lists present and identical (null when one is missing). */
  match: boolean | null;
  /** Human-readable differences, one per item. */
  differences: string[];
  items: OutcomeItem[];
}

/** One section in the cut view. */
export interface CutSection extends SectionTime {
  /** Share of the slot (0–1), null without a slot. */
  share: number | null;
  /** The three longest visible slides by planned minutes. */
  longest: Array<{ slide: number; title: string; minutes: number }>;
}

/** Where to cut: time per section against the slot. */
export interface CutView {
  slotMinutes: number | null;
  minutesPlanned: number;
  /** Planned minus slot (positive = over), null without a slot. */
  overSlot: number | null;
  sections: CutSection[];
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

/** Attribute blocks that are animation steps: both `.fragment` and `.step`. */
export function countSteps(text: string): number {
  return [...text.matchAll(/\{[^{}]*\}/g)]
    .filter((m) => /\.fragment\b/.test(m[0]) && /\.step\b/.test(m[0])).length;
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

/** Rule ids from a heading's `lint-ignore="a,b"` attribute. */
export function parseIgnore(raw: string): string[] {
  const m = raw.match(ATTR_RE);
  if (!m) return [];
  const v = m[1].match(/lint-ignore\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/);
  if (!v) return [];
  return (v[1] ?? v[2] ?? v[3]).split(/[\s,]+/).filter(Boolean);
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
        if (/\bRef(?:erence)?s?:|doi:|doi\.org\//i.test(notes)) {
          cur.hasRef = true;
        }
        for (const l of notes.split("\n")) {
          if (/^\s*Ref(?:erence)?s?:/i.test(l)) cur.refLines.push(l.trim());
        }
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
        cur.steps += countSteps(open[2]);
        const cls = open[2].startsWith("{")
          ? [...open[2].matchAll(/\.([\w-]+)/g)].map((x) => x[1])
          : [open[2].trim().split(/\s+/)[0]];
        cur.divClasses.push(...cls);
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
        steps: 0,
        hasRef: false,
        hasNotes: false,
        minutes: null,
        images: [],
        src: [],
        refLines: [],
        dois: [],
        checks: [],
        body: [],
        bodyLines: [],
        divClasses: [],
        ignore: parseIgnore(h[2]),
      };
      slides.push(cur);
      continue;
    }
    if (!cur) continue;
    cur.body.push(text);
    cur.bodyLines.push(line);
    cur.fragments += (text.match(/\.fragment\b/g) ?? []).length;
    cur.steps += countSteps(text);
    cur.images.push(...imagesInLine(text));
    for (const s of text.matchAll(/\[([^\]]+)\]\{\.src\b[^}]*\}/g)) {
      cur.src.push(s[1]);
    }
  }
  return { slides, title, orphanChecks };
}

/**
 * Sentences the audience actually reads on a slide: the title, prose written in
 * the body, and the contents of `<text>` elements in an inline SVG diagram.
 * Figures, `.src` citations, div markers and raw markup are left out.
 */
export function audienceText(s: SlideInfo): string[] {
  const out: string[] = [];
  if (s.title) out.push(s.title);
  for (
    const m of s.body.join("\n").matchAll(/<text\b[^>]*>([^<]+)<\/text>/g)
  ) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  for (const raw of s.body) {
    const line = raw.trim();
    if (!line) continue;
    if (/^:{3,}/.test(line) || /^</.test(line)) continue; // divs, raw HTML/SVG
    if (/^!\[/.test(line)) continue; // a figure
    if (/^\[[^\]]+\]\{\.src\b/.test(line)) continue; // the citation line
    const plain = line
      .replace(/!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g, "")
      .replace(/\[([^\]]*)\]\{[^}]*\}/g, "$1")
      .replace(/[*_`]/g, "")
      .trim();
    if (plain) out.push(plain);
  }
  return out;
}

/** Words that only make sense spoken by the lecturer, in the room, that day. */
const NARRATION_MARKERS: Array<[RegExp, string, RuleId]> = [
  [/\b(we|us|our|ours)\b/i, "first person", "first-person"],
  [/\blet'?s\b/i, "first person", "first-person"],
  [/\btoday\b/i, "names the occasion", "occasion"],
  [
    /\bthis (lecture|talk|session|morning|afternoon|slide)\b/i,
    "names the lecture",
    "occasion",
  ],
  [/\bthe whole (lecture|talk|day|story)\b/i, "names the lecture", "occasion"],
  [/\b(slot|rung)s?\b/i, "timetable or scaffolding word", "scaffolding"],
  [/\b(before|after) the break\b/i, "timetable word", "scaffolding"],
  [/\bnext (slide|lecture|week)\b/i, "names the lecture", "occasion"],
  [
    /^open question\b/i,
    "an open question belongs in the notes",
    "open-question",
  ],
];

/** Scaffolding prefixes: they describe the argument, not the finding. */
const SCAFFOLD_TITLE =
  /^(approach|the control|the general rule|the reading|the puzzle|key figures?|recap|summary of|slot|rung)\b\s*[:.]?/i;

/** Titles that only name a part of a talk, not what the slide shows. */
const TOPIC_TITLE =
  /^(?:(?:key |main )?results?|background|introduction|intro|methods?|discussion|overview|outline|agenda|data|motivation|aims?|context|findings)\s*[:.!]?$/i;

/** A conclusions / take-home slide (not the learning-outcomes review). */
const CONCLUSION_TITLE =
  /\b(conclusions?|take[- ]home|key points|in short|summary)\b/i;
const CAVEAT_LINE = /^(caveats?|limitations?|note|n\.?\s?b\.?)\s*:/i;

const WORDS = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Smallest SVG font size the room can read (user units of a 1180-wide viewBox). */
export const MIN_SVG_FONT = 16;

/**
 * Inline-SVG findings on one slide: blank lines inside `<svg>…</svg>` (Quarto
 * splits the raw HTML block there) and `font-size` values below
 * `MIN_SVG_FONT`, each with its line.
 */
export function svgFindings(s: SlideInfo): {
  blank: number[];
  small: Array<{ line: number; size: number }>;
} {
  const blank: number[] = [];
  const small: Array<{ line: number; size: number }> = [];
  let depth = 0;
  s.body.forEach((text, i) => {
    const line = s.bodyLines[i] ?? s.line;
    if (depth > 0 && text.trim() === "") blank.push(line);
    const opens = (text.match(/<svg\b/g) ?? []).length;
    const closes = (text.match(/<\/svg>/g) ?? []).length;
    if (depth > 0 || opens > 0) {
      for (
        const m of text.matchAll(
          /font-size\s*(?:=\s*["']?|:\s*)(\d+(?:\.\d+)?)(px)?(?![\d.]*(?:em|rem|%|pt))/g,
        )
      ) {
        const size = Number(m[1]);
        if (size < MIN_SVG_FONT) small.push({ line, size });
      }
    }
    depth = Math.max(0, depth + opens - closes);
  });
  return { blank, small };
}

/**
 * House-style lint for visible slides. A "paper slide" is one with a `.src`
 * line: it should show one figure from one source, without click builds, and
 * cite the DOI in its notes. Every `##` slide should have notes that start with
 * a timing. Returns every finding; `lintDeck` applies `lint-ignore`.
 */
/** A source line naming unpublished data, a photo credit or a website. */
const SRC_CREDIT =
  /unpublished|personal communication|courtesy|photo|times|guardian|newspaper|magazine|news\b|©|https?:\/\/|www\./i;
/** Author(s) + year, then journal + volume:page: "… 2010, Nature 464:121". */
const SRC_COMPLETE =
  /\b(1[89]|20)\d{2}\b[^,]*,\s*[A-Za-z][^,]*?\s\d+:\s?[A-Za-z]?\d+/;

/** Reference findings: incomplete `.src` lines, the lecturer not in bold. */
export function referenceIssues(
  slides: SlideInfo[],
  highlightAuthor?: string,
): StyleIssue[] {
  const out: StyleIssue[] = [];
  const add = (s: SlideInfo, id: RuleId, message: string) =>
    out.push({
      slide: s.n,
      title: s.title,
      id,
      rule: LINT_RULES[id].family,
      level: LINT_RULES[id].level,
      message,
      file: s.file,
      line: s.line,
    });
  const name = highlightAuthor?.trim();
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = name
    ? new RegExp(`(^|[^\\p{L}*])${esc(name)}(?![\\p{L}*])`, "u")
    : null;
  for (const s of slides) {
    if (s.hidden) continue;
    for (const src of s.src) {
      if (
        !SRC_CREDIT.test(src) && !SRC_COMPLETE.test(src.replace(/\*\*/g, ""))
      ) {
        add(s, "src-incomplete", `"${src}" lacks year, journal or volume:page`);
      }
    }
    if (named) {
      for (const l of [...s.src, ...s.refLines]) {
        if (named.test(l)) {
          add(
            s,
            "author-not-bold",
            `${name} is not bold in "${l.slice(0, 90)}"`,
          );
        }
      }
    }
  }
  return out;
}

export function styleIssues(slides: SlideInfo[]): StyleIssue[] {
  const out: StyleIssue[] = [];
  const add = (
    s: SlideInfo,
    id: RuleId,
    message: string,
    line = s.line,
  ) =>
    out.push({
      slide: s.n,
      title: s.title,
      id,
      rule: LINT_RULES[id].family,
      level: LINT_RULES[id].level,
      message,
      file: s.file,
      line,
    });
  for (const s of slides) {
    if (s.hidden) continue;
    // a broken SVG breaks section slides too
    const svg = svgFindings(s);
    for (const line of svg.blank) {
      add(
        s,
        "svg-blank-line",
        `blank line inside <svg> at ${s.file}:${line}; Quarto splits the slide there, remove it`,
        line,
      );
    }
    if (svg.small.length) {
      const min = Math.min(...svg.small.map((x) => x.size));
      add(
        s,
        "svg-small-text",
        `${svg.small.length} SVG text${
          svg.small.length > 1 ? "s" : ""
        } below font-size ${MIN_SVG_FONT} (smallest ${min}) from ${s.file}:${
          svg.small[0].line
        }`,
        svg.small[0].line,
      );
    }
    if (s.level !== 2) continue;
    const paper = s.src.length > 0;
    if (paper && s.images.length > 1) {
      add(
        s,
        "two-images",
        `${s.images.length} images on a paper slide; show one figure`,
      );
    }
    if (s.src.length > 1) {
      add(
        s,
        "two-sources",
        `${s.src.length} source lines; one paper per slide`,
      );
    }
    const builds = s.fragments - s.steps;
    if (paper && builds > 0) {
      add(
        s,
        "builds",
        `${builds} click builds on a paper slide; talk over the figure instead`,
      );
    }
    if (!s.hasNotes) add(s, "no-notes", "no speaker notes");
    else if (s.minutes === null) {
      add(
        s,
        "no-timing",
        "notes do not start with a timing like ~1.5' or ~45 s",
      );
    }
    if (paper && s.hasNotes && !s.hasRef) {
      add(
        s,
        "no-ref",
        "paper slide whose notes cite no reference (Ref: … doi:…)",
      );
    }
    if (SCAFFOLD_TITLE.test(s.title)) {
      add(
        s,
        "scaffold-title",
        `title "${s.title}" is scaffolding; state the finding or name what the slide shows`,
      );
    } else if (TOPIC_TITLE.test(s.title.trim())) {
      add(
        s,
        "topic-title",
        `title "${s.title}" is a topic word; state the finding or name what the slide shows`,
      );
    }
    if (CONCLUSION_TITLE.test(s.title) && !/learning outcome/i.test(s.title)) {
      const table = s.body.some((l) =>
        /^\s*\|.*\|\s*$/.test(l) || /<table\b/i.test(l)
      );
      if (table) {
        add(
          s,
          "conclusion-table",
          "conclusions as a table; write a few bullets, each tied to a slide of the talk",
        );
      }
      const bullets = s.body.filter((l) => /^[-*+]\s+\S/.test(l)).length;
      if (bullets > 5) {
        add(
          s,
          "conclusion-long",
          `${bullets} bullets on the conclusions slide; keep the few the talk showed`,
        );
      }
    }
    const shown = audienceText(s);
    for (const line of shown) {
      if (CAVEAT_LINE.test(line.trim())) {
        add(
          s,
          "caveat-line",
          `"${line}" is a caveat on the slide; keep it only if the talk raises it`,
        );
      }
      for (const [re, why, id] of NARRATION_MARKERS) {
        if (re.test(line)) {
          add(s, id, `"${line}" (${why}); move it to the notes`);
          break;
        }
      }
    }
    // A free-standing sentence next to a figure or diagram is usually a spoken
    // take-home line. Judgement call, so a hint.
    const hasVisual = s.images.length > 0 ||
      s.body.some((l) => /<svg\b/.test(l));
    if (hasVisual) {
      for (const line of shown) {
        if (line === s.title) continue;
        for (const sentence of line.split(/(?<=[.!])\s+/)) {
          if (/[.!]$/.test(sentence.trim()) && WORDS(sentence) >= 6) {
            add(
              s,
              "spoken-line",
              `"${sentence.trim()}" reads as a spoken line beside a figure`,
            );
          }
        }
      }
    }
  }
  return out;
}

const OPENING_LO = /^learning outcomes?$/i;
const CLOSING_LO = /^learning outcomes?\b.*\b(revisited|again|review(ed)?)\b/i;

/** Numbered list items (`1. text`, continuation lines joined) in a slide body. */
export function numberedItems(
  s: SlideInfo,
): Array<{ n: number; text: string; line: number }> {
  const out: Array<{ n: number; text: string; line: number }> = [];
  let last: { n: number; text: string; line: number } | null = null;
  s.body.forEach((raw, i) => {
    const m = raw.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (m) {
      last = { n: Number(m[1]), text: m[2].trim(), line: s.bodyLines[i] };
      out.push(last);
    } else if (last && /^\s{2,}\S/.test(raw)) {
      last.text += " " + raw.trim();
    } else if (raw.trim() === "" || /^:{3,}/.test(raw.trim())) last = null;
  });
  return out.map((x) => ({ ...x, text: x.text.replace(/\s+/g, " ") }));
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "in",
  "on",
  "to",
  "and",
  "or",
  "for",
  "with",
  "by",
  "from",
  "its",
  "it",
  "is",
  "are",
  "as",
  "at",
]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when `text` contains the key term: every content word of the term, as
 * a word prefix (long words lose their last three letters, so "mammalian"
 * matches "mammals").
 */
export function mentions(text: string, term: string): boolean {
  const words = term.toLowerCase().split(/\s+/).map((w) =>
    w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+]+$/gu, "")
  ).filter((w) => w && !STOP.has(w));
  if (!words.length) return false;
  const t = text.toLowerCase();
  return words.every((w) => {
    const stem = w.length > 5 && /^\p{L}+$/u.test(w) ? w.slice(0, -3) : w;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(stem)}`, "u").test(t);
  });
}

/** Split a bold key term like "HK1, HK2 and HK3" into its parts. */
export function termParts(term: string): string[] {
  return term.split(/,\s*|\s+(?:and|or)\s+|\s*\/\s*/i).map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Learning-outcome check. The opening list is the slide titled "Learning
 * outcomes" (or holding a `.lo` div); the closing one is "Learning outcomes
 * revisited" (or `.lo-done`). Their numbered items must be identical; every
 * outcome's bold key terms should appear on at least one other visible slide.
 */
export function learningOutcomes(slides: SlideInfo[]): OutcomeReport | null {
  const visible = slides.filter((s) => !s.hidden);
  const opening =
    visible.find((s) =>
      OPENING_LO.test(s.title) || s.divClasses.includes("lo") ||
      s.classes.includes("lo")
    ) ?? null;
  const closing =
    visible.find((s) =>
      s !== opening && (CLOSING_LO.test(s.title) ||
        s.divClasses.includes("lo-done") || s.classes.includes("lo-done"))
    ) ?? null;
  if (!opening && !closing) return null;
  const open = opening ? numberedItems(opening) : [];
  const close = closing ? numberedItems(closing) : [];
  const differences: string[] = [];
  let match: boolean | null = null;
  if (opening && closing) {
    for (let i = 0; i < Math.max(open.length, close.length); i++) {
      const a = open[i], b = close[i];
      if (!a) differences.push(`item ${b.n} only in the closing list`);
      else if (!b) differences.push(`item ${a.n} only in the opening list`);
      else if (a.text !== b.text) {
        differences.push(
          `item ${a.n} differs: "${a.text}" vs "${b.text}" (${closing.file}:${b.line})`,
        );
      }
    }
    match = differences.length === 0;
  }
  const others = visible.filter((s) => s !== opening && s !== closing);
  const shown = new Map(
    others.map((s) => [s.n, audienceText(s).join(" \n ")]),
  );
  const items: OutcomeItem[] = (open.length ? open : close).map((it) => {
    const terms = [...it.text.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => {
      const term = m[1].trim();
      const parts = termParts(term);
      const hit = others.filter((s) =>
        parts.some((p) => mentions(shown.get(s.n) ?? "", p))
      ).map((s) => s.n);
      return { term, slides: hit };
    });
    return {
      n: it.n,
      text: it.text,
      terms,
      slides: [...new Set(terms.flatMap((t) => t.slides))].sort((a, b) =>
        a - b
      ),
    };
  });
  return {
    opening: opening?.n ?? null,
    closing: closing?.n ?? null,
    match,
    differences,
    items,
  };
}

/** Findings of the learning-outcome check, in `StyleIssue` form. */
export function outcomeIssues(
  slides: SlideInfo[],
  r: OutcomeReport | null,
): StyleIssue[] {
  if (!r) return [];
  const out: StyleIssue[] = [];
  const at = (n: number | null) => slides.find((s) => s.n === n);
  const closing = at(r.closing), opening = at(r.opening);
  const mk = (s: SlideInfo, id: RuleId, message: string): StyleIssue => ({
    slide: s.n,
    title: s.title,
    id,
    rule: LINT_RULES[id].family,
    level: LINT_RULES[id].level,
    message,
    file: s.file,
    line: s.line,
  });
  if (closing && r.match === false) {
    for (const d of r.differences) {
      out.push(mk(closing, "lo-mismatch", `learning outcomes revisited: ${d}`));
    }
  }
  const home = opening ?? closing;
  if (home) {
    for (const it of r.items) {
      if (it.terms.length && it.slides.length === 0) {
        out.push(
          mk(
            home,
            "lo-uncovered",
            `outcome ${it.n} (${
              it.terms.map((t) => t.term).join(", ")
            }) appears on no slide`,
          ),
        );
      }
    }
  }
  return out;
}

/**
 * Everything `outline` reports as lint: house style plus the learning-outcome
 * check, split into active findings and those the slide accepts with
 * `lint-ignore` (an id, or a family name such as `narration`). Unknown ids in
 * `lint-ignore` are themselves a hint.
 */
export function lintDeck(
  slides: SlideInfo[],
  hasTitleSlide = true,
  highlightAuthor?: string,
): {
  issues: StyleIssue[];
  suppressed: StyleIssue[];
  outcomes: OutcomeReport | null;
} {
  const shown = shownNumbers(slides, hasTitleSlide);
  const number = (x: StyleIssue) => {
    x.shown = shown.get(x.slide) ?? null;
  };
  const out = lintDeckBySource(slides, highlightAuthor);
  out.issues.forEach(number);
  out.suppressed.forEach(number);
  return out;
}

/**
 * Slide-counter number of each slide by source index, as `buildSlideMap`
 * numbers them: the title slide (front matter `title:`) is 1, hidden slides
 * get none.
 */
export function shownNumbers(
  slides: SlideInfo[],
  hasTitleSlide = true,
): Map<number, number> {
  const m = new Map<number, number>();
  let k = hasTitleSlide ? 1 : 0;
  for (const s of slides) if (!s.hidden) m.set(s.n, ++k);
  return m;
}

/** "slide 58" by the counter number, or "hidden slide (source 61)". */
export function issueSlide(x: { slide: number; shown?: number | null }) {
  if (x.shown === undefined) return `slide ${x.slide}`;
  return x.shown === null
    ? `hidden slide (source ${x.slide})`
    : `slide ${x.shown}`;
}

function lintDeckBySource(slides: SlideInfo[], highlightAuthor?: string): {
  issues: StyleIssue[];
  suppressed: StyleIssue[];
  outcomes: OutcomeReport | null;
} {
  const outcomes = learningOutcomes(slides);
  const all = [
    ...styleIssues(slides),
    ...referenceIssues(slides, highlightAuthor),
    ...outcomeIssues(slides, outcomes),
  ];
  const families = new Set<string>(
    Object.values(LINT_RULES).map((r) => r.family),
  );
  const byN = new Map(slides.map((s) => [s.n, s]));
  const issues: StyleIssue[] = [];
  const suppressed: StyleIssue[] = [];
  for (const x of all) {
    const ign = byN.get(x.slide)?.ignore ?? [];
    if (ign.includes(x.id) || ign.includes(x.rule)) suppressed.push(x);
    else issues.push(x);
  }
  for (const s of slides) {
    if (s.hidden) continue;
    for (const id of s.ignore) {
      if (id in LINT_RULES || families.has(id)) continue;
      issues.push({
        slide: s.n,
        title: s.title,
        id: "unknown-ignore",
        rule: "lint",
        level: "hint",
        message: `lint-ignore names "${id}", which is no rule id`,
        file: s.file,
        line: s.line,
      });
    }
  }
  issues.sort((a, b) => a.slide - b.slide);
  return { issues, suppressed, outcomes };
}

/**
 * Planned minutes per `#` section over visible slides; slides before the first
 * section form "Opening". Empty sections (all slides hidden) are left out.
 */
export function sectionTimes(slides: SlideInfo[]): SectionTime[] {
  const out: SectionTime[] = [];
  let cur: SectionTime = {
    title: "Opening",
    slide: null,
    slides: 0,
    minutes: 0,
  };
  const flush = () => {
    if (cur.slides > 0) {
      out.push({ ...cur, minutes: Math.round(cur.minutes * 10) / 10 });
    }
  };
  for (const s of slides) {
    if (s.hidden) continue;
    if (s.level === 1) {
      flush();
      cur = { title: s.title, slide: s.n, slides: 0, minutes: 0 };
    }
    cur.slides++;
    cur.minutes += s.minutes ?? 0;
  }
  flush();
  return out;
}

/**
 * Where to cut: per `#` section (or per included file when the deck has no
 * `#` headings) the slides, planned minutes, share of the slot and the three
 * longest visible slides; plus the total over or under.
 */
export function cutView(
  slides: SlideInfo[],
  slotMinutes: number | null = null,
): CutView {
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const visible = slides.filter((s) => !s.hidden);
  // Group by `#` section; a deck without `#` headings (sections drawn as
  // `##` overview slides) is grouped by the file each slide is written in.
  const bySection = visible.some((s) => s.level === 1);
  const groups: Array<{ title: string; slide: number | null; s: SlideInfo[] }> =
    [];
  for (const s of visible) {
    const last = groups[groups.length - 1];
    const starts = bySection ? s.level === 1 : !last || last.title !== s.file;
    if (starts || !last) {
      groups.push({
        title: bySection ? (s.level === 1 ? s.title : "Opening") : s.file,
        slide: bySection && s.level !== 1 ? null : s.n,
        s: [s],
      });
    } else last.s.push(s);
  }
  const planned = r1(visible.reduce((a, s) => a + (s.minutes ?? 0), 0));
  return {
    slotMinutes,
    minutesPlanned: planned,
    overSlot: slotMinutes ? r1(planned - slotMinutes) : null,
    sections: groups.map((g) => {
      const minutes = r1(g.s.reduce((a, s) => a + (s.minutes ?? 0), 0));
      return {
        title: g.title,
        slide: g.slide,
        slides: g.s.length,
        minutes,
        share: slotMinutes
          ? Math.round(100 * minutes / slotMinutes) / 100
          : null,
        longest: g.s
          .filter((s) => (s.minutes ?? 0) > 0)
          .sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0) || a.n - b.n)
          .slice(0, 3)
          .map((s) => ({
            slide: s.n,
            title: s.title || audienceText(s)[0]?.slice(0, 60) || "(untitled)",
            minutes: s.minutes ?? 0,
          })),
      };
    }),
  };
}

/** The cut view as plain lines, for the log and the report. */
export function cutLines(c: CutView): string[] {
  const out: string[] = [];
  if (c.slotMinutes) {
    const d = c.overSlot ?? 0;
    out.push(
      `${c.minutesPlanned} min planned for a ${c.slotMinutes} min slot: ${
        d > 0 ? `${d} min over, cut ${d}` : `${-d} min spare`
      }`,
    );
  } else out.push(`${c.minutesPlanned} min planned (no slot set)`);
  for (const s of c.sections) {
    const share = s.share === null
      ? ""
      : `, ${Math.round(s.share * 100)}% of slot`;
    const top = s.longest.map((x) => `${x.minutes}' "${x.title}"`).join("; ");
    out.push(
      `${s.title}: ${s.slides} slides, ${s.minutes} min${share}${
        top ? ` — longest: ${top}` : ""
      }`,
    );
  }
  return out;
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
    highlightAuthor?: string;
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
  const lint = lintDeck(slides, parsed.title !== null, opts.highlightAuthor);
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
    styleIssues: lint.issues,
    suppressed: lint.suppressed,
    outcomes: lint.outcomes,
    sections: sectionTimes(slides),
    cut: cutView(slides, opts.slotMinutes ?? null),
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

/** Front-matter keys whose values are files of the deck. */
const FM_FILE_KEYS = [
  "include-in-header",
  "include-before-body",
  "include-after-body",
  "css",
  "theme",
  "logo",
];

/**
 * Files the YAML front matter of a .qmd refers to (`include-in-header`,
 * `include-before-body`, `include-after-body`, `css`, `theme`, `logo`), as
 * scalars, inline lists or block lists. Values without a file extension
 * (built-in themes such as `default`) and `text:` blocks are skipped.
 */
export function frontMatterFiles(
  text: string,
): Array<{ key: string; path: string; line: number }> {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return [];
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  if (end < 0) return [];
  const out: Array<{ key: string; path: string; line: number }> = [];
  const unq = (v: string) => v.trim().replace(/^["']|["']$/g, "").trim();
  const isFile = (v: string) =>
    /\.[A-Za-z0-9]{1,5}$/.test(v) && !/[<>{}]/.test(v);
  const add = (key: string, v: string, line: number) => {
    const p = unq(v);
    if (p && isFile(p)) out.push({ key, path: p, line });
  };
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^(\s*)([\w-]+):\s*(.*)$/);
    if (!m || !FM_FILE_KEYS.includes(m[2])) continue;
    const [, indent, key, rest] = m;
    const v = rest.replace(/\s+#.*$/, "").trim();
    if (v.startsWith("[")) {
      for (const it of v.replace(/^\[|\]$/g, "").split(",")) {
        add(key, it, i + 1);
      }
    } else if (v) {
      add(key, v, i + 1);
    } else {
      for (let j = i + 1; j < end; j++) {
        const lm = lines[j].match(/^(\s*)-\s+(.*)$/);
        if (!lm || lm[1].length <= indent.length) break;
        add(key, lm[2], j + 1);
      }
    }
  }
  return out;
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
  // Quarto pastes a missing include-in-header path into the page as text and
  // drops a missing theme/css silently, so check them here
  for (const f of frontMatterFiles(Deno.readTextFileSync(join(dir, main)))) {
    if (!fileExists(join(dir, f.path))) missing.push(`${f.path} (${f.key})`);
  }
  return { lines, files, missing };
}

/** Outline a deck on disk. */
export function outlineDeck(
  dir: string,
  main: string,
  slotMinutes?: number | null,
  highlightAuthor?: string,
): DeckOutline {
  const { lines, files, missing } = expandIncludes(dir, main);
  const parsed = parseQmd(lines);
  return outlineFromSlides(main, files, parsed, {
    slotMinutes,
    highlightAuthor,
    exists: (p) => fileExists(join(dir, p)),
    missingIncludes: missing,
  });
}
