/**
 * The house slide patterns as code, so every deck gets them the same way:
 *
 * - paper: title = the message, ONE figure from ONE source, one `.src` line,
 *   speaker notes with timing, the story and the full reference + DOI. No
 *   bullet builds.
 * - section: divider in the deck's section colour with a one-line subtitle.
 *
 * Colours come from the deck's `_brand.yml` (`brand.ts`); the defaults are
 * the neutral template's.
 * - statement: one big sentence.
 *
 * Plus inserting the markdown into a section file (append, or after the slide
 * whose title contains a given text).
 * @module
 */
import { z } from "npm:zod@4";
import { type DeckPalette, DEFAULT_PALETTE, isDark, textOn } from "./brand.ts";

/** Inputs for a paper slide. */
export interface PaperSlide {
  title: string;
  image: string;
  citation: string;
  minutes: number;
  notes: string;
  reference?: string;
  doi?: string | null;
  /** CSS max-height of the figure in px; default: stretch to fit. */
  maxHeight?: number;
}

/** Format minutes the way the notes do: ~1.5' or ~45 s. */
export function timing(minutes: number): string {
  if (minutes < 1) return `~${Math.round(minutes * 60)} s`;
  return `~${Number(minutes.toFixed(1))}'`;
}

/** Wrap text to `width` columns (notes stay readable in the source). */
export function wrap(text: string, width = 88): string {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + " " + w).length > width) {
        out.push(line);
        line = w;
      } else line = line ? line + " " + w : w;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Markdown of a paper slide. */
export function paperSlide(s: PaperSlide): string {
  const img = s.maxHeight
    ? `![](${s.image}){style="max-height: ${s.maxHeight}px; display: block; margin: 0 auto;"}`
    : `![](${s.image}){.r-stretch}`;
  const base = (s.reference ?? s.citation).replace(/[.,\s]+$/, "");
  // the DOI once: not again when the reference already carries it
  const hasDoi = s.doi && base.toLowerCase().includes(s.doi.toLowerCase());
  const ref = [base, s.doi && !hasDoi ? `doi:${s.doi}` : ""].filter(Boolean)
    .join(", ");
  return [
    `## ${s.title}`,
    "",
    img,
    "",
    `[${s.citation}]{.src}`,
    "",
    "::: notes",
    wrap(`${timing(s.minutes)}. ${s.notes.trim()}`),
    wrap(`Ref: ${ref}.`),
    ":::",
    "",
  ].join("\n");
}

/** Markdown of a section divider. */
export function sectionSlide(
  title: string,
  subtitle = "",
  color = DEFAULT_PALETTE.section,
  notes = "",
  minutes?: number,
): string {
  const n = notes.trim();
  return [
    `# ${title} {.section .center background-color="${color}"}`,
    "",
    ...(subtitle ? [subtitle, ""] : []),
    ...(n || minutes
      ? [
        "::: notes",
        wrap(`${timing(minutes ?? 0.5)}.${n ? ` ${n}` : ""}`),
        ":::",
        "",
      ]
      : []),
  ].join("\n");
}

/** Markdown of a statement slide. */
export function statementSlide(
  text: string,
  minutes: number,
  notes = "",
): string {
  return [
    "## {.statement .center}",
    "",
    text,
    "",
    "::: notes",
    wrap(`${timing(minutes)}. ${notes.trim()}`.trim()),
    ":::",
    "",
  ].join("\n");
}

/**
 * Insert `block` into `source`: at the end, or before the heading that
 * follows the slide whose title contains `after`.
 */
export function insertSlide(
  source: string,
  block: string,
  after?: string,
): string {
  const body = source.replace(/\s*$/, "\n");
  if (!after) return body + "\n" + block;
  const lines = body.split("\n");
  let fence = false;
  let found = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(`{3,}|~{3,})/.test(lines[i])) fence = !fence;
    if (fence || !/^#{1,2}\s/.test(lines[i])) continue;
    if (found >= 0) {
      return [
        ...lines.slice(0, i),
        ...block.replace(/\n*$/, "\n").split("\n"),
        ...lines.slice(i),
      ]
        .join("\n");
    }
    if (lines[i].includes(after)) found = i;
  }
  if (found < 0) throw new Error(`no slide titled like "${after}"`);
  return body + "\n" + block;
}

// ---------------------------------------------------------------------------
// Diagram patterns: the inline-SVG layouts that were hand-written again and
// again. Each takes structured input, emits one `<svg class="diagram">` in
// the deck's colours with no blank line inside it (Quarto would split the slide),
// no text below font-size 16, and fragments as
// `<g class="fragment" data-fragment-index="i">`.
// ---------------------------------------------------------------------------

/** Colour roles: what a panel, box or row means, not which hex it gets. */
export const RoleSchema = z.enum(["good", "bad", "neutral", "muted"]);
export type Role = z.infer<typeof RoleSchema>;

/** Stroke/text colour and tint per role, from the deck palette. */
export function roleColours(
  pal: DeckPalette = DEFAULT_PALETTE,
): Record<Role, { ink: string; tint: string }> {
  return {
    good: { ink: pal.good, tint: pal.tints.good },
    bad: { ink: pal.bad, tint: pal.tints.bad },
    neutral: { ink: pal.primary, tint: pal.tints.neutral },
    muted: { ink: pal.muted, tint: pal.tints.muted },
  };
}

const W = 1180;
const H = 470;
const MIN_FONT = 16;

/** Escape text for SVG/HTML. */
export function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Approximate rendered width of `text` at `size` (sans-serif). */
export function textWidth(text: string, size: number, bold = false): number {
  return text.length * size * (bold ? 0.56 : 0.52);
}

/**
 * Wrap `text` into lines that fit `maxWidth`, shrinking the font (never below
 * 16) until it fits in `maxLines`.
 */
export function fitText(
  text: string,
  size: number,
  maxWidth: number,
  maxLines = 2,
  bold = false,
): { lines: string[]; size: number } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wrapAt = (sz: number) => {
    const out: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && textWidth(next, sz, bold) > maxWidth) {
        out.push(line);
        line = w;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  let sz = size;
  let lines = wrapAt(sz);
  while (lines.length > maxLines && sz > MIN_FONT) {
    sz = Math.max(MIN_FONT, sz - 2);
    lines = wrapAt(sz);
  }
  return { lines, size: sz };
}

/** Diagram text has no closing full stop (it would read as a spoken line). */
const bare = (s: string) => s.trim().replace(/(?<!\.)\.$/, "");

interface TextOpts {
  size: number;
  weight?: 400 | 700;
  fill: string;
  maxWidth: number;
  maxLines?: number;
  anchor?: "middle" | "start";
  /** Treat the y coordinate as the top of the block instead of its centre. */
  top?: boolean;
}

/**
 * `<text>` lines for `text` centred vertically on `cy` (one element per line,
 * so the lint can read every line).
 */
export function textLines(x: number, cy: number, text: string, o: TextOpts): {
  svg: string[];
  height: number;
} {
  const bold = (o.weight ?? 400) === 700;
  const f = fitText(bare(text), o.size, o.maxWidth, o.maxLines ?? 2, bold);
  const lh = Math.round(f.size * 1.2);
  const mid = o.top ? cy + (lh * f.lines.length) / 2 : cy;
  const top = mid - (lh * (f.lines.length - 1)) / 2 + f.size * 0.35;
  return {
    svg: f.lines.map((l, i) =>
      `<text x="${Math.round(x)}" y="${
        Math.round(top + i * lh)
      }" text-anchor="${
        o.anchor ?? "middle"
      }" font-size="${f.size}" font-weight="${
        o.weight ?? 400
      }" fill="${o.fill}">${xml(l)}</text>`
    ),
    height: lh * f.lines.length,
  };
}

/** A straight arrow with a drawn head (no marker ids, so no clashes between slides). */
export function arrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colour: string,
  width = 4,
): string {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const hl = 4 + width * 2.5;
  const p = (da: number) =>
    `${Math.round(x2 - hl * Math.cos(a + da))},${
      Math.round(y2 - hl * Math.sin(a + da))
    }`;
  return `<path d="M${x1},${y1} L${x2},${y2}" stroke="${colour}" stroke-width="${width}" fill="none" stroke-linecap="round"/>` +
    `<path d="M${p(0.5)} L${x2},${y2} L${
      p(-0.5)
    }" stroke="${colour}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/**
 * Wrap groups in the house `<svg class="diagram">`; never emits a blank line.
 * Drawn for a dark background it says so (`data-bg="dark"`), so a dark
 * theme does not put it on a light card.
 */
export function diagram(
  label: string,
  groups: string[][],
  pal: DeckPalette = DEFAULT_PALETTE,
): string {
  const body = groups.flatMap((g) => g).map((l) => `  ${l}`);
  const bg = isDark(pal.background) ? ' data-bg="dark"' : "";
  return [
    `<svg class="diagram"${bg} viewBox="0 0 ${W} ${H}" role="img" aria-label="${
      xml(label)
    }">`,
    ...body,
    "</svg>",
  ].filter((l) => l.trim() !== "").join("\n");
}

/** `<g>` around `inner`, a fragment when `index` is a number. */
function group(inner: string[], index: number | null): string[] {
  return [
    index === null
      ? "<g>"
      : `<g class="fragment" data-fragment-index="${index}">`,
    ...inner.map((l) => `  ${l}`),
    "</g>",
  ];
}

// -- compare_two -------------------------------------------------------------

const PanelSchema = z.object({
  heading: z.string().describe('e.g. "with LDHA"'),
  role: RoleSchema.default("neutral"),
  steps: z.array(z.string()).min(1).max(3).describe(
    "short chain, top to bottom",
  ),
  outcome: z.string(),
  detail: z.string().optional().describe("small line under the outcome"),
});

export const CompareTwoSchema = z.object({
  left: PanelSchema,
  right: PanelSchema,
  bottom: z.string().optional().describe(
    "bar in the primary colour under both panels",
  ),
  build: z.boolean().default(true).describe("left, right, bottom on clicks"),
});
export type CompareTwo = z.input<typeof CompareTwoSchema>;

function panel(
  x: number,
  w: number,
  h: number,
  p: z.infer<typeof PanelSchema>,
  pal: DeckPalette,
) {
  const c = roleColours(pal)[p.role];
  const cx = x + w / 2;
  const out: string[] = [
    `<rect x="${x}" y="20" width="${w}" height="${h}" rx="14" fill="${c.tint}" stroke="${c.ink}" stroke-width="2.5"/>`,
    ...textLines(cx, 56, p.heading, {
      size: 27,
      weight: 700,
      fill: c.ink,
      maxWidth: w - 40,
      maxLines: 1,
    }).svg,
  ];
  // steps as boxes with arrows, then the outcome text
  const top = 86, foot = p.detail ? 92 : 64;
  const avail = 20 + h - foot - top;
  const n = p.steps.length;
  const gap = 34;
  const boxH = Math.min(64, (avail - gap * n) / n);
  let y = top;
  for (const step of p.steps) {
    out.push(
      `<rect x="${x + 40}" y="${Math.round(y)}" width="${w - 80}" height="${
        Math.round(boxH)
      }" rx="10" fill="${pal.surface}" stroke="${c.ink}" stroke-width="2"/>`,
      ...textLines(cx, y + boxH / 2, step, {
        size: 24,
        weight: 700,
        fill: pal.ink,
        maxWidth: w - 110,
      }).svg,
    );
    y += boxH;
    out.push(arrow(cx, Math.round(y + 4), cx, Math.round(y + gap - 4), c.ink));
    y += gap;
  }
  const outcome = textLines(cx, y - 2, p.outcome, {
    size: 24,
    weight: 700,
    fill: c.ink,
    maxWidth: w - 40,
    top: true,
  });
  out.push(...outcome.svg);
  if (p.detail) {
    out.push(
      ...textLines(cx, y + outcome.height + 2, p.detail, {
        size: 20,
        fill: c.ink,
        maxWidth: w - 40,
        maxLines: 1,
        top: true,
      }).svg,
    );
  }
  return out;
}

/** Two side-by-side panels, "with X / without X", each a chain and an outcome. */
export function compareTwoSvg(
  input: CompareTwo,
  pal: DeckPalette = DEFAULT_PALETTE,
): string {
  const s = CompareTwoSchema.parse(input);
  const h = s.bottom ? 362 : 430;
  const f = (i: number) => (s.build ? i : null);
  const groups = [
    group(panel(20, 550, h, s.left, pal), f(1)),
    group(panel(610, 550, h, s.right, pal), f(2)),
  ];
  if (s.bottom) {
    groups.push(group([
      `<rect x="20" y="398" width="1140" height="62" rx="14" fill="${pal.primary}"/>`,
      ...textLines(590, 429, s.bottom, {
        size: 27,
        weight: 700,
        fill: pal.onPrimary,
        maxWidth: 1100,
        maxLines: 1,
      }).svg,
    ], f(3)));
  }
  const label = `${s.left.heading}: ${s.left.steps.join(", ")}, ${
    bare(s.left.outcome)
  }; ${s.right.heading}: ${s.right.steps.join(", ")}, ${bare(s.right.outcome)}`;
  return diagram(label, groups, pal);
}

// -- claim_vs_data -----------------------------------------------------------

export const ClaimVsDataSchema = z.object({
  cards: z.array(z.object({
    claim: z.string(),
    measurement: z.string(),
    detail: z.string().optional(),
  })).min(1).max(3),
  claimLabel: z.string().default("the claim"),
  dataLabel: z.string().default("the measurement"),
  build: z.boolean().default(true).describe("one card per click"),
});
export type ClaimVsData = z.input<typeof ClaimVsDataSchema>;

/** 1–3 cards: muted claim pill, arrow and measurement box in the `bad` colour. */
export function claimVsDataSvg(
  input: ClaimVsData,
  pal: DeckPalette = DEFAULT_PALETTE,
): string {
  const s = ClaimVsDataSchema.parse(input);
  const n = s.cards.length;
  const gap = 40;
  const w = (1140 - gap * (n - 1)) / n;
  const groups = s.cards.map((c, i) => {
    const x = 20 + i * (w + gap);
    const cx = x + w / 2;
    const inner = w - 80;
    return group([
      `<rect x="${Math.round(x)}" y="20" width="${
        Math.round(w)
      }" height="400" rx="14" fill="${pal.surface}" stroke="${pal.primary}" stroke-width="2.5"/>`,
      `<rect x="${Math.round(x + 40)}" y="48" width="${
        Math.round(inner)
      }" height="104" rx="40" fill="${pal.pill}"/>`,
      ...textLines(cx, 72, s.claimLabel, {
        size: 18,
        fill: pal.muted,
        maxWidth: inner - 30,
        maxLines: 1,
      }).svg,
      ...textLines(cx, 114, c.claim, {
        size: 27,
        weight: 700,
        fill: pal.ink,
        maxWidth: inner - 40,
      }).svg,
      arrow(Math.round(cx), 164, Math.round(cx), 214, pal.bad, 5),
      `<rect x="${Math.round(x + 40)}" y="228" width="${
        Math.round(inner)
      }" height="172" rx="14" fill="${pal.tints.bad}" stroke="${pal.bad}" stroke-width="2"/>`,
      ...textLines(cx, 256, s.dataLabel, {
        size: 18,
        fill: pal.muted,
        maxWidth: inner - 30,
        maxLines: 1,
      }).svg,
      ...textLines(cx, c.detail ? 306 : 320, c.measurement, {
        size: 27,
        weight: 700,
        fill: pal.bad,
        maxWidth: inner - 40,
      }).svg,
      ...(c.detail
        ? textLines(cx, 366, c.detail, {
          size: 21,
          fill: pal.ink,
          maxWidth: inner - 40,
        }).svg
        : []),
    ], s.build ? i + 1 : null);
  });
  const label = s.cards.map((c) =>
    `${s.claimLabel}: ${bare(c.claim)}; ${s.dataLabel}: ${bare(c.measurement)}`
  ).join(". ");
  return diagram(label, groups, pal);
}

// -- chain -------------------------------------------------------------------

export const ChainSchema = z.object({
  boxes: z.array(z.object({
    label: z.string(),
    sub: z.string().optional().describe("small grey line in the box"),
    role: RoleSchema.default("neutral"),
  })).min(2).max(4).describe("left to right, usually 3"),
  arrows: z.array(z.string()).default([]).describe(
    "labels on the arrows between boxes (boxes - 1)",
  ),
  results: z.array(z.object({
    text: z.string(),
    role: RoleSchema.default("neutral"),
  })).max(3).default([]).describe("rows beneath the chain"),
  build: z.boolean().default(true).describe(
    "first box, then each arrow + box, then each result row, on clicks",
  ),
});
export type Chain = z.input<typeof ChainSchema>;

/** Boxes left to right with labelled arrows, plus optional result rows. */
export function chainSvg(
  input: Chain,
  pal: DeckPalette = DEFAULT_PALETTE,
): string {
  const s = ChainSchema.parse(input);
  const n = s.boxes.length;
  const gap = n > 3 ? 120 : 160;
  const w = (1140 - gap * (n - 1)) / n;
  const rows = s.results.length;
  const boxY = rows ? 50 : 140, boxH = 150;
  const groups: string[][] = [];
  // the first box stands; each further box (with its arrow) and each result
  // row is one click
  const f = (i: number) => (s.build && i > 0 ? i : null);
  const roles = roleColours(pal);
  s.boxes.forEach((b, i) => {
    const c = roles[b.role];
    const x = 20 + i * (w + gap);
    const cx = x + w / 2;
    const inner: string[] = [];
    if (i > 0) {
      const ax1 = Math.round(x - gap + 10), ax2 = Math.round(x - 10);
      const my = boxY + boxH / 2;
      inner.push(arrow(ax1, my + 18, ax2, my + 18, pal.primary, 4));
      const lab = s.arrows[i - 1];
      if (lab) {
        inner.push(
          ...textLines((ax1 + ax2) / 2, my - 16, lab, {
            size: 18,
            weight: 700,
            fill: pal.muted,
            maxWidth: gap - 16,
            maxLines: 3,
          }).svg,
        );
      }
    }
    inner.push(
      `<rect x="${Math.round(x)}" y="${boxY}" width="${
        Math.round(w)
      }" height="${boxH}" rx="14" fill="${c.tint}" stroke="${c.ink}" stroke-width="2.5"/>`,
      ...textLines(cx, boxY + (b.sub ? 58 : boxH / 2), b.label, {
        size: 26,
        weight: 700,
        fill: c.ink,
        maxWidth: w - 30,
      }).svg,
      ...(b.sub
        ? textLines(cx, boxY + 112, b.sub, {
          size: 19,
          fill: pal.muted,
          maxWidth: w - 30,
        }).svg
        : []),
    );
    groups.push(group(inner, f(i)));
  });
  const rowH = 58, rowGap = 14;
  s.results.forEach((r, i) => {
    const c = roles[r.role];
    const y = boxY + boxH + 40 + i * (rowH + rowGap);
    groups.push(group([
      `<rect x="20" y="${y}" width="1140" height="${rowH}" rx="12" fill="${c.tint}" stroke="${c.ink}" stroke-width="2"/>`,
      ...textLines(590, y + rowH / 2, r.text, {
        size: 24,
        weight: 700,
        fill: c.ink,
        maxWidth: 1090,
        maxLines: 1,
      }).svg,
    ], f(n + i)));
  });
  const label =
    s.boxes.map((b, i) =>
      (i > 0 && s.arrows[i - 1] ? `${s.arrows[i - 1]} ` : "") + b.label
    ).join(", then ") +
    (rows ? `. ${s.results.map((r) => bare(r.text)).join("; ")}` : "");
  return diagram(label, groups, pal);
}

// -- statement_image ---------------------------------------------------------

export const StatementImageSchema = z.object({
  image: z.string().describe("background image, shown on the right half"),
  lines: z.array(z.string()).min(1).max(4).describe(
    "paragraphs on the left; **bold** is highlighted",
  ),
  background: z.string().optional().describe(
    "colour behind the left half; default: the deck's section colour",
  ),
  highlight: z.string().optional().describe(
    "colour of **bold** words; default: the deck's highlight colour",
  ),
  width: z.number().default(38).describe("text width in % of the slide"),
});
export type StatementImage = z.input<typeof StatementImageSchema>;

/** Body of a statement slide with text on the section colour left and an image right. */
export function statementImageBody(
  input: StatementImage,
  pal: DeckPalette = DEFAULT_PALETTE,
): {
  heading: string;
  body: string;
} {
  const s = StatementImageSchema.parse(input);
  const background = s.background ?? pal.section;
  const highlight = s.highlight ?? pal.highlight;
  const text = s.background ? textOn(s.background) : pal.onSection;
  const rich = (t: string) =>
    xml(t).replace(
      /\*\*([^*]+)\*\*/g,
      `<b style="color: ${highlight} !important;">$1</b>`,
    );
  const heading =
    `## {.statement .sm background-image="${s.image}" background-size="auto 100%" background-position="right center" background-repeat="no-repeat" background-color="${background}"}`;
  const ps = s.lines.map((l, i) =>
    `<p style="color: ${text} !important; text-align: left !important; margin: ${
      i === s.lines.length - 1 ? "0" : "0 0 0.9em 0"
    };">${rich(l.trim())}</p>`
  );
  return {
    heading,
    body: [
      `<div style="width: ${s.width}%; margin-left: 4%; margin-top: 3em; text-align: left;">`,
      ...ps,
      "</div>",
    ].join("\n"),
  };
}

// -- registry ----------------------------------------------------------------

/** Common slide fields for every pattern. */
export interface PatternSlide {
  title: string;
  minutes: number;
  notes: string;
  /** Optional `.src` line under the diagram (a model drawn from a paper). */
  citation?: string;
  reference?: string;
}

/** The diagram patterns `slide_add` knows, by kind. */
export const PATTERNS = {
  compare_two: {
    schema: CompareTwoSchema,
    what:
      "two panels side by side (with X / without X), each a short chain and an outcome; optional bottom line in the primary colour",
  },
  claim_vs_data: {
    schema: ClaimVsDataSchema,
    what:
      "1–3 cards: muted claim pill, arrow and measurement box in the 'bad' colour",
  },
  chain: {
    schema: ChainSchema,
    what:
      "2–4 boxes left to right with labelled arrows, optional result rows beneath",
  },
  statement_image: {
    schema: StatementImageSchema,
    what:
      "statement slide: text on the section colour left, background image on the right half",
  },
} as const;

export type PatternKind = keyof typeof PATTERNS;
export const PATTERN_KINDS = Object.keys(PATTERNS) as PatternKind[];

/** Markdown of a slide built from a diagram pattern. */
export function patternSlide(
  kind: PatternKind,
  spec: unknown,
  s: PatternSlide,
  pal: DeckPalette = DEFAULT_PALETTE,
): string {
  const notes = [
    "::: notes",
    wrap(`${timing(s.minutes)}. ${s.notes.trim()}`.trim()),
    ...(s.reference ? [wrap(`Ref: ${s.reference}.`)] : []),
    ":::",
    "",
  ];
  const src = s.citation ? ["", `[${s.citation}]{.src}`] : [];
  if (kind === "statement_image") {
    const b = statementImageBody(spec as StatementImage, pal);
    return [b.heading, "", b.body, ...src, "", ...notes].join("\n");
  }
  const svg = kind === "compare_two"
    ? compareTwoSvg(spec as CompareTwo, pal)
    : kind === "claim_vs_data"
    ? claimVsDataSvg(spec as ClaimVsData, pal)
    : chainSvg(spec as Chain, pal);
  return [`## ${s.title}`, "", svg, ...src, "", ...notes].join("\n");
}
