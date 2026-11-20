/**
 * Deck templates: a look (colours, fonts, logo/footer placement, title-slide
 * colour) that a deck can start from (`deck_init`) or switch to
 * (`template_apply`), shipped with the extension in `templates/`:
 *
 * - `templates/shared/` — structure every template needs: `deck-base.html`
 *   (the house classes `.src`, `.lo`, `.cmp`, `.task`, … written against
 *   CSS variables), `defaults.scss` and `rules.scss` (Quarto variables and
 *   reveal rules written against `$qd-*` SCSS variables).
 * - `templates/<name>/` — `_brand.yml` (the colours, the single source of
 *   truth, also read by `slide_add`) and `theme.scss` (fonts, switches,
 *   template-only rules).
 *
 * A deck gets `_brand.yml` next to its main file, `theme/<name>.scss`
 * (generated: palette from `_brand.yml` + template + shared parts) and
 * `theme/deck-base.html`; the main file's YAML gets `theme`,
 * `include-in-header`, the title-slide background and optionally `logo` and
 * `footer`. Content is never touched.
 *
 * The file texts are embedded in `templates_bundle.ts` (`templates/build.ts`).
 * @module
 */
import { z } from "npm:zod@4.6.7";
import {
  type Brand,
  brandPalette,
  type DeckPalette,
  normHex,
  parseBrand,
} from "./brand.ts";
import { TEMPLATE_FILES } from "./templates_bundle.ts";
import { type Backup, putBack, snapshot } from "./edit.ts";
import { outlineDeck } from "./outline.ts";
import { checkDeck, contactSheets } from "./check.ts";
import { launchChrome } from "./chrome.ts";
import { renderDeck } from "./render.ts";
import {
  paperSlide,
  patternSlide,
  sectionSlide,
  statementSlide,
} from "./slides.ts";

/** The templates the extension ships. */
export const TEMPLATES = {
  wur: {
    description:
      "Wageningen University & Research: navy + Wageningen green, Archivo/IBM Plex Sans, green bar along the top, green tick under titles, navy title slide, logo bottom right (bring your own logo file)",
    logo: "assets/logo.png",
  },
  neutral: {
    description:
      "Plain academic: white background, near-black text, one blue accent, Source Sans Pro, hairline under titles",
    logo: null,
  },
  dark: {
    description:
      "Dark slate background, light text, teal accent, Inter; for evening talks and projectors. Light-page figures and hand-drawn SVG sit on a light card",
    logo: null,
  },
  contrast: {
    description:
      "High contrast for large rooms and printed hand-outs: white, black, one cobalt accent, Atkinson Hyperlegible, larger small print",
    logo: null,
  },
} as const;

export type TemplateName = keyof typeof TEMPLATES;
export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as TemplateName[];
export const TemplateNameSchema = z.enum(
  TEMPLATE_NAMES as [TemplateName, ...TemplateName[]],
);

/** Where the template's files go, relative to the main file's folder. */
export const THEME_DIR = "theme";
export const BASE_HTML = `${THEME_DIR}/deck-base.html`;
export const themeScss = (name: string) => `${THEME_DIR}/${name}.scss`;

/**
 * Header includes a template replaces: its own structural file, and the
 * earlier name for it (the classes moved into `deck-base.html`).
 */
export const OWNED_INCLUDES = [BASE_HTML, `${THEME_DIR}/deck-extras.html`];
/** A theme entry a template replaces: any `.scss` in `theme/`. */
const OWNED_THEME = /^theme\/[^/]+\.scss$/;

/** A file of the template library (throws when missing). */
export function templateFile(path: string): string {
  const t = TEMPLATE_FILES[path];
  if (t === undefined) throw new Error(`template file ${path} not found`);
  return t;
}

/** A template's `_brand.yml`, parsed. */
export function templateBrand(name: TemplateName): Brand {
  return parseBrand(templateFile(`${name}/_brand.yml`));
}

/** Split an SCSS theme file into its defaults and rules sections. */
export function scssSections(
  text: string,
): { defaults: string; rules: string } {
  const d = text.indexOf("/*-- scss:defaults --*/");
  const r = text.indexOf("/*-- scss:rules --*/");
  if (d < 0 || r < 0 || r < d) {
    throw new Error(
      "theme.scss needs /*-- scss:defaults --*/ then /*-- scss:rules --*/",
    );
  }
  return {
    defaults: text.slice(d + "/*-- scss:defaults --*/".length, r).trim(),
    rules: text.slice(r + "/*-- scss:rules --*/".length).trim(),
  };
}

/** `$qd-*` SCSS variables for a palette. */
export function paletteScss(p: DeckPalette): string {
  const q = (s: string | null) => s === null ? "null" : JSON.stringify(s);
  const fonts = {
    base: p.fonts.base ?? "Source Sans Pro",
    headings: p.fonts.headings ?? p.fonts.base ?? "Source Sans Pro",
  };
  return [
    `$qd-primary: ${p.primary};`,
    `$qd-on-primary: ${p.onPrimary};`,
    `$qd-good: ${p.good};`,
    `$qd-bad: ${p.bad};`,
    `$qd-muted: ${p.muted};`,
    `$qd-ink: ${p.ink};`,
    `$qd-surface: ${p.surface};`,
    `$qd-pill: ${p.pill};`,
    `$qd-highlight: ${p.highlight};`,
    `$qd-bg: ${p.background};`,
    `$qd-fg: ${p.foreground};`,
    `$qd-accent: ${p.accent};`,
    `$qd-accent-ink: ${p.accentInk};`,
    `$qd-rule: ${p.rule};`,
    `$qd-section: ${p.section};`,
    `$qd-on-section: ${p.onSection};`,
    `$qd-title-slide: ${q(p.titleSlide)};`,
    `$qd-tint-good: ${p.tints.good};`,
    `$qd-tint-bad: ${p.tints.bad};`,
    `$qd-tint-neutral: ${p.tints.neutral};`,
    `$qd-tint-muted: ${p.tints.muted};`,
    `$qd-font-base: ${q(fonts.base)};`,
    `$qd-font-headings: ${q(fonts.headings)};`,
  ].join("\n");
}

/**
 * The deck's `theme/<name>.scss`: palette (from `_brand.yml`), the
 * template's defaults, the shared defaults, the shared rules, the template's
 * rules.
 */
export function composeScss(name: TemplateName, pal: DeckPalette): string {
  const t = scssSections(templateFile(`${name}/theme.scss`));
  return [
    "/*-- scss:defaults --*/",
    `// Generated by quarto-deck (template "${name}") from _brand.yml and the`,
    "// template library. Change colours in _brand.yml, then run",
    `// template_apply template=${name} keepBrand=true; edits here are overwritten.`,
    "",
    "// ---- palette (from _brand.yml) ----",
    paletteScss(pal),
    "",
    t.defaults,
    "",
    templateFile("shared/defaults.scss").trim(),
    "",
    "/*-- scss:rules --*/",
    templateFile("shared/rules.scss").trim(),
    "",
    `// ---- template "${name}" ----`,
    t.rules,
    "",
  ].join("\n");
}

/** Folder of the main file within the deck dir ("" for the root). */
export function mainDir(main: string): string {
  const i = main.lastIndexOf("/");
  return i < 0 ? "" : main.slice(0, i);
}

const rel = (main: string, p: string) =>
  mainDir(main) ? `${mainDir(main)}/${p}` : p;

/**
 * The files a template writes, by path relative to the deck dir. With
 * `brandText` the deck keeps that `_brand.yml` and the theme follows it.
 */
export function templateOutputs(
  name: TemplateName,
  main: string,
  brandText?: string,
): Record<string, string> {
  const brand = brandText ?? templateFile(`${name}/_brand.yml`);
  const pal = brandPalette(parseBrand(brand));
  return {
    [rel(main, "_brand.yml")]: brand,
    [rel(main, themeScss(name))]: composeScss(name, pal),
    [rel(main, BASE_HTML)]: templateFile("shared/deck-base.html"),
  };
}

// ---------------------------------------------------------------------------
// YAML front matter: rewrite only the keys a template owns, line by line, so
// comments, order and every other key stay as they are.
// ---------------------------------------------------------------------------

/** The template-owned keys to set. `undefined` = leave as is. */
export interface TemplateKeys {
  /** Theme file of the template, e.g. `theme/dark.scss`. */
  theme: string;
  /** Structural include, `theme/deck-base.html`. */
  include: string;
  logo?: string;
  footer?: string;
  /** Title-slide background; null removes it. */
  titleBackground: string | null;
}

const indentOf = (l: string) => l.length - l.trimStart().length;
const blank = (l: string) => l.trim() === "" || /^\s*#/.test(l);
/** A YAML scalar's value: double-quoted (JSON escapes), single-quoted or plain. */
function unquote(v: string): string {
  const t = v.trim();
  if (/^".*"$/.test(t)) {
    try {
      return JSON.parse(t);
    } catch { /* not JSON-compatible: strip the quotes */ }
  }
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  return t.replace(/^["']|["']$/g, "").trim();
}

/** End (exclusive) of the block that starts at line `i` (deeper lines). */
function blockEnd(lines: string[], i: number, end = lines.length): number {
  const ind = indentOf(lines[i]);
  let j = i + 1;
  let last = i + 1;
  for (; j < end; j++) {
    if (blank(lines[j])) continue;
    if (indentOf(lines[j]) <= ind) break;
    last = j + 1;
  }
  return last;
}

/** Index of `key:` at exactly `indent` within [from, to), or -1. */
function findKey(
  lines: string[],
  key: string,
  indent: number,
  from: number,
  to: number,
): number {
  const re = new RegExp(`^\\s{${indent}}${key.replace(/-/g, "\\-")}:(\\s|$)`);
  for (let i = from; i < to; i++) {
    if (
      !blank(lines[i]) && indentOf(lines[i]) === indent && re.test(lines[i])
    ) {
      return i;
    }
  }
  return -1;
}

/** Items of a YAML value: scalar, inline list or block list (scalars only). */
export function yamlItems(lines: string[], i: number, end: number): string[] {
  const v = lines[i].slice(lines[i].indexOf(":") + 1).trim();
  if (v.startsWith("[")) {
    return v.replace(/^\[|\]$/g, "").split(",").map(unquote).filter(Boolean);
  }
  if (v && !v.startsWith("#")) return [unquote(v)];
  return lines.slice(i + 1, end).filter((l) => /^\s*-\s/.test(l)).map((l) =>
    unquote(l.replace(/^\s*-\s*/, ""))
  );
}

/** Lines of the front matter (between the first two `---`), or throw. */
function frontMatterRange(lines: string[]): { start: number; end: number } {
  if (lines[0]?.trim() !== "---") {
    throw new Error("the main file has no YAML front matter");
  }
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  if (end < 0) throw new Error("the YAML front matter is not closed");
  return { start: 1, end };
}

/** The `format: revealjs:` block of the front matter (created if missing). */
function revealBlock(lines: string[]): {
  start: number;
  end: number;
  child: number;
} {
  let { end } = frontMatterRange(lines);
  let f = findKey(lines, "format", 0, 1, end);
  if (f < 0) {
    lines.splice(end, 0, "format:", "  revealjs:");
    end += 2;
    f = end - 2;
  } else {
    const v = lines[f].slice(lines[f].indexOf(":") + 1).trim();
    if (v === "revealjs") {
      lines.splice(f, 1, "format:", "  revealjs:");
      end += 1;
    } else if (v && !v.startsWith("#")) {
      throw new Error(`format is "${v}", not revealjs`);
    }
  }
  const fEnd = blockEnd(lines, f, end);
  let r = -1;
  for (let i = f + 1; i < fEnd; i++) {
    if (/^\s+revealjs:/.test(lines[i])) {
      r = i;
      break;
    }
  }
  if (r < 0) {
    const ind = lines.slice(f + 1, fEnd).find((l) => !blank(l));
    const pad = " ".repeat(ind ? indentOf(ind) : 2);
    lines.splice(f + 1, 0, `${pad}revealjs:`);
    r = f + 1;
    end += 1;
  }
  const rv = lines[r].slice(lines[r].indexOf(":") + 1).trim();
  if (rv && !rv.startsWith("#")) {
    if (rv !== "default" && rv !== "{}") {
      throw new Error(`format: revealjs: has an inline value "${rv}"`);
    }
    lines[r] = lines[r].slice(0, lines[r].indexOf(":") + 1);
  }
  const rEnd = blockEnd(lines, r, frontMatterRange(lines).end);
  const firstChild = lines.slice(r + 1, rEnd).find((l) => !blank(l));
  return {
    start: r + 1,
    end: rEnd,
    child: firstChild ? indentOf(firstChild) : indentOf(lines[r]) + 2,
  };
}

/** Set (replace or append) `key` in the revealjs block. */
function setKey(lines: string[], key: string, rendered: string[]): void {
  const b = revealBlock(lines);
  const pad = " ".repeat(b.child);
  const out = rendered.map((l) => pad + l);
  const i = findKey(lines, key, b.child, b.start, b.end);
  if (i >= 0) lines.splice(i, blockEnd(lines, i, b.end) - i, ...out);
  else lines.splice(b.end, 0, ...out);
}

function removeKey(lines: string[], key: string): boolean {
  const b = revealBlock(lines);
  const i = findKey(lines, key, b.child, b.start, b.end);
  if (i < 0) return false;
  lines.splice(i, blockEnd(lines, i, b.end) - i);
  return true;
}

/** Current scalar items of a revealjs key (empty when absent). */
function getItems(lines: string[], key: string): string[] {
  const b = revealBlock(lines);
  const i = findKey(lines, key, b.child, b.start, b.end);
  return i < 0 ? [] : yamlItems(lines, i, blockEnd(lines, i, b.end));
}

const yq = (s: string) => /^[\w./-]+$/.test(s) ? s : JSON.stringify(s);
const inlineList = (xs: string[]) => `[${xs.map(yq).join(", ")}]`;

/** Result of rewriting the front matter. */
export interface KeyRewrite {
  text: string;
  changes: string[];
  /** Header includes that were dropped (template-owned, now replaced). */
  dropped: string[];
}

/**
 * Rewrite the template-owned keys of a deck's main file (`theme`,
 * `include-in-header`, the title-slide background, and `logo`/`footer` when
 * given); everything else is left byte for byte.
 */
export function applyTemplateKeys(text: string, k: TemplateKeys): KeyRewrite {
  const lines = text.split("\n");
  const changes: string[] = [];
  // theme: keep built-in and non-template entries, replace theme/*.scss
  const oldTheme = getItems(lines, "theme");
  const keep = oldTheme.filter((t) => !OWNED_THEME.test(t));
  const theme = [...(keep.length ? keep : ["default"]), k.theme];
  if (inlineList(theme) !== inlineList(oldTheme)) {
    setKey(lines, "theme", [`theme: ${inlineList(theme)}`]);
    changes.push(`theme: ${inlineList(oldTheme)} → ${inlineList(theme)}`);
  }
  // include-in-header: replace the structural include, keep the others
  const oldInc = getItems(lines, "include-in-header");
  const b0 = revealBlock(lines);
  const incAt = findKey(lines, "include-in-header", b0.child, b0.start, b0.end);
  const isBlock = incAt >= 0 &&
    lines[incAt].slice(lines[incAt].indexOf(":") + 1).trim() === "";
  const dropped = oldInc.filter((x) => OWNED_INCLUDES.includes(x));
  const inc = [...oldInc.filter((x) => !OWNED_INCLUDES.includes(x)), k.include];
  if (isBlock) {
    // a block list may hold `text:` entries: edit the scalar items in place
    const end = blockEnd(lines, incAt, b0.end);
    const body = lines.slice(incAt + 1, end).filter((l) =>
      !(/^\s*-\s/.test(l) &&
        OWNED_INCLUDES.includes(unquote(l.replace(/^\s*-\s*/, ""))))
    );
    const pad = " ".repeat(b0.child + 2);
    if (JSON.stringify(inc) !== JSON.stringify(oldInc)) {
      lines.splice(incAt + 1, end - incAt - 1, ...body, `${pad}- ${k.include}`);
      changes.push(`include-in-header: + ${k.include}`);
    }
  } else if (JSON.stringify(inc) !== JSON.stringify(oldInc)) {
    setKey(lines, "include-in-header", [
      `include-in-header: ${inc.length === 1 ? yq(inc[0]) : inlineList(inc)}`,
    ]);
    changes.push(
      `include-in-header: ${inlineList(oldInc)} → ${inlineList(inc)}`,
    );
  }
  if (k.logo !== undefined) {
    const old = getItems(lines, "logo")[0];
    if (old !== k.logo) {
      setKey(lines, "logo", [`logo: ${yq(k.logo)}`]);
      changes.push(`logo: ${old ?? "(none)"} → ${k.logo}`);
    }
  }
  if (k.footer !== undefined) {
    const old = getItems(lines, "footer")[0];
    if (old !== k.footer) {
      setKey(lines, "footer", [`footer: ${JSON.stringify(k.footer)}`]);
      changes.push(`footer: ${old ?? "(none)"} → ${k.footer}`);
    }
  }
  // title-slide-attributes: data-background-color
  const b = revealBlock(lines);
  const t = findKey(lines, "title-slide-attributes", b.child, b.start, b.end);
  const tEnd = t >= 0 ? blockEnd(lines, t, b.end) : -1;
  const childPad = " ".repeat(b.child + 2);
  const bgAt = t >= 0
    ? lines.slice(t + 1, tEnd).findIndex((l) =>
      /^\s*data-background-color:/.test(l)
    )
    : -1;
  const oldBg = bgAt >= 0
    ? unquote(lines[t + 1 + bgAt].replace(/^\s*data-background-color:/, ""))
    : null;
  if ((oldBg ?? null) !== k.titleBackground) {
    if (k.titleBackground !== null) {
      const line = `${childPad}data-background-color: ${
        JSON.stringify(k.titleBackground)
      }`;
      if (bgAt >= 0) lines[t + 1 + bgAt] = line;
      else if (t >= 0) lines.splice(t + 1, 0, line);
      else {
        setKey(lines, "title-slide-attributes", [
          "title-slide-attributes:",
          `  data-background-color: ${JSON.stringify(k.titleBackground)}`,
        ]);
      }
    } else if (bgAt >= 0) {
      lines.splice(t + 1 + bgAt, 1);
      const rest = lines.slice(t + 1, tEnd - 1).filter((l) => !blank(l));
      if (!rest.length) removeKey(lines, "title-slide-attributes");
    }
    changes.push(
      `title-slide background: ${oldBg ?? "(none)"} → ${
        k.titleBackground ?? "(none)"
      }`,
    );
  }
  return { text: lines.join("\n"), changes, dropped };
}

/** Values of the template-owned keys a deck has now. */
export function currentTemplateKeys(text: string): {
  theme: string[];
  include: string[];
  logo: string | null;
  footer: string | null;
} {
  const lines = text.split("\n");
  return {
    theme: getItems(lines, "theme"),
    include: getItems(lines, "include-in-header"),
    logo: getItems(lines, "logo")[0] ?? null,
    footer: getItems(lines, "footer")[0] ?? null,
  };
}

/** The template a deck uses now (from its `theme/<name>.scss`), or null. */
export function currentTemplate(text: string): TemplateName | null {
  for (const t of currentTemplateKeys(text).theme) {
    const m = t.match(/^theme\/([^/]+)\.scss$/);
    if (m && (TEMPLATE_NAMES as string[]).includes(m[1])) {
      return m[1] as TemplateName;
    }
  }
  return null;
}

/** Class names used in CSS selectors of a stylesheet/HTML. */
export function cssClasses(css: string): Set<string> {
  const out = new Set<string>();
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /\/\/[^\n]*/g,
    "",
  );
  for (const block of noComments.matchAll(/([^{}]+)\{/g)) {
    for (const m of block[1].matchAll(/\.([A-Za-z][\w-]*)/g)) out.add(m[1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// New deck
// ---------------------------------------------------------------------------

/** Inputs of a new deck. */
export interface NewDeck {
  template: TemplateName;
  title: string;
  subtitle?: string;
  author?: string;
  footer?: string;
  logo?: string | null;
  titleBackground: string | null;
}

/** Main `.qmd` of a new deck: YAML for the template, title + outcomes. */
export function newDeckQmd(d: NewDeck): string {
  const q = JSON.stringify;
  const y = [
    "---",
    `title: ${q(d.title)}`,
    ...(d.subtitle ? [`subtitle: ${q(d.subtitle)}`] : []),
    ...(d.author ? [`author: ${q(d.author)}`] : []),
    "format:",
    "  revealjs:",
    `    theme: [default, ${themeScss(d.template)}]`,
    ...(d.logo ? [`    logo: ${yq(d.logo)}`] : []),
    "    width: 1280",
    "    height: 720",
    "    transition: fade",
    "    slide-number: c/t",
    ...(d.footer ? [`    footer: ${q(d.footer)}`] : []),
    "    fig-align: center",
    "    auto-stretch: true",
    "    pdf-separate-fragments: false",
    `    include-in-header: ${BASE_HTML}`,
    ...(d.titleBackground
      ? [
        "    title-slide-attributes:",
        `      data-background-color: ${q(d.titleBackground)}`,
      ]
      : []),
    "execute:",
    "  echo: false",
    "  warning: false",
    "---",
    "",
  ];
  const lo = (cls: string, title: string, notes: string) => [
    `## ${title}`,
    "",
    `::: {.${cls}}`,
    "1. Outcome one, with its **key term** in bold",
    ":::",
    "",
    "::: notes",
    notes,
    ":::",
    "",
  ];
  return [
    ...y,
    ...lo(
      "lo",
      "Learning outcomes",
      "~1'. CHECK: write 4–5 outcomes; keep this list and the revisited list identical.",
    ),
    ...lo(
      "lo-done",
      "Learning outcomes revisited",
      "~1'. CHECK: the same list as the opening slide.",
    ),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Sample deck for template_preview
// ---------------------------------------------------------------------------

/** A small deck that shows every slide kind, in the colours of `pal`. */
export function sampleDeck(name: TemplateName, pal: DeckPalette): string {
  const s = { minutes: 1, notes: "Sample." };
  const head = newDeckQmd({
    template: name,
    title: "Glycolysis keeps muscle running",
    subtitle: `Template preview · ${name}`,
    author: "A. Lecturer · Department of Physiology",
    footer: `quarto-deck · ${name}`,
    titleBackground: pal.titleSlide,
  }).split("## Learning outcomes")[0];
  const lo = [
    "1. Explain how **PFK1** sets the pace of glycolysis",
    "2. Name the **ten glycolytic enzymes** and where each works",
    "3. Judge the **lactate** claims against the measurements",
  ];
  const tiny = (t: string) => `\n::: notes\n~30 s. ${t}\n:::\n`;
  return [
    head.trimEnd(),
    "",
    "## Learning outcomes",
    "",
    "::: {.lo}",
    ...lo,
    ":::",
    tiny("Outcomes."),
    sectionSlide(
      "Glycolysis: glucose to pyruvate",
      "PFK1 is the gate",
      pal.section,
    ),
    statementSlide(
      "Blocking **PFK1** cuts lactate output by 30%",
      0.5,
      "Statement.",
    ),
    paperSlide({
      title: "Higher doses shorten survival",
      image: "figure.svg",
      citation: "Sample et al. 2026, J Sample 1:1, Fig. 1A",
      minutes: 1,
      notes: "Paper slide.",
    }),
    patternSlide(
      "compare_two",
      {
        left: {
          heading: "with LDHA",
          role: "good",
          steps: ["pyruvate reduced to lactate", "glycolysis keeps running"],
          outcome: "normal ATP supply",
        },
        right: {
          heading: "without LDHA",
          role: "bad",
          steps: ["pyruvate accumulates", "glycolysis slows"],
          outcome: "early muscle fatigue",
        },
        bottom: "LDHA keeps glycolysis running",
        build: false,
      },
      { title: "How LDHA keeps glycolysis running", ...s },
      pal,
    ),
    patternSlide(
      "claim_vs_data",
      {
        cards: [
          {
            claim: "lactate causes muscle soreness",
            measurement: "lactate is cleared within an hour",
          },
          {
            claim: "lactate is a waste product",
            measurement: "heart and brain burn it as fuel",
          },
        ],
        build: false,
      },
      { title: "Lactate: the claims and the measurements", ...s },
      pal,
    ),
    patternSlide(
      "chain",
      {
        boxes: [
          { label: "exercise", sub: "ATP falls" },
          { label: "AMP rises" },
          { label: "PFK1 active", role: "good" },
        ],
        arrows: ["raises", "activates"],
        results: [{ text: "more fructose-1,6-bisphosphate", role: "neutral" }, {
          text: "faster glycolysis",
          role: "muted",
        }],
        build: false,
      },
      { title: "Exercise activates PFK1 through AMP", ...s },
      pal,
    ),
    patternSlide(
      "statement_image",
      {
        image: "backdrop.svg",
        lines: [
          "Blocking an **enzyme** slows a tumour.",
          "Could a **molecule** do the same?",
        ],
      },
      { title: "", ...s },
      pal,
    ),
    "## Learning outcomes revisited",
    "",
    "::: {.lo-done}",
    ...lo,
    ":::",
    tiny("Outcomes revisited."),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

type Handle = { name: string };
interface Writer {
  writeAll(content: Uint8Array): Promise<Handle>;
  getFilePath?(): Promise<string>;
  finalize?(): Promise<Handle>;
}

/** Minimal method context (the model's DeckContext satisfies it). */
export interface TemplateContext {
  globalArgs: { dir: string; main: string; chrome?: string; quarto?: string };
  logger: { info: (msg: string, props?: Record<string, unknown>) => void };
  writeResource: (
    spec: string,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<Handle>;
  readResource?: (name: string) => Promise<Record<string, unknown> | null>;
  createFileWriter: (spec: string, name: string) => Writer;
}

type JournalFn = (
  ctx: TemplateContext,
  entry: { kind: "change" | "decision"; text: string; ref?: string },
) => Promise<Handle>;

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

/** One hex colour rewritten by `template_apply recolour=true`. */
export interface Recolour {
  file: string;
  line: number;
  from: string;
  to: string;
}

/** The colour roles of a palette as role -> #RRGGBB (tints as `tint.<role>`). */
function paletteRoles(p: DeckPalette): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === "string") out.push([k, v]);
  }
  for (const [k, v] of Object.entries(p.tints)) out.push([`tint.${k}`, v]);
  return out.flatMap(([k, v]) => {
    try {
      return [[k, normHex(v)] as [string, string]];
    } catch {
      return [];
    }
  });
}

/**
 * Which role a hex counts as when several old roles share it: the diagram
 * roles first (what `slide_add` draws with), then text and fills, then the
 * theme-level roles.
 */
export const ROLE_PRIORITY = [
  "primary",
  "good",
  "bad",
  "muted",
  "ink",
  "surface",
  "onPrimary",
  "pill",
  "highlight",
  "rule",
  "accent",
  "accentInk",
  "foreground",
  "background",
  "section",
  "onSection",
  "titleSlide",
];

/**
 * Old brand hex -> new brand hex, role by role (old primary -> new primary,
 * …). A hex several old roles share goes where its highest-priority role
 * (`ROLE_PRIORITY`, then tints) goes; `shared` lists those whose roles part
 * ways in the new brand. A hex that stays the same is left out.
 */
export function colourMap(
  old: DeckPalette,
  neu: DeckPalette,
): {
  map: Map<string, string>;
  shared: Array<{ hex: string; roles: string[]; as: string }>;
} {
  const want = new Map(paletteRoles(neu));
  const rank = (r: string) => {
    const i = ROLE_PRIORITY.indexOf(r);
    return i < 0 ? ROLE_PRIORITY.length : i;
  };
  const byHex = new Map<string, string[]>();
  for (const [role, hex] of paletteRoles(old)) {
    if (!want.has(role)) continue;
    byHex.set(hex, [...(byHex.get(hex) ?? []), role]);
  }
  const map = new Map<string, string>();
  const shared: Array<{ hex: string; roles: string[]; as: string }> = [];
  for (const [hex, roles] of byHex) {
    roles.sort((a, b) => rank(a) - rank(b));
    const n = want.get(roles[0])!;
    if (new Set(roles.map((r) => want.get(r))).size > 1) {
      shared.push({ hex, roles, as: roles[0] });
    }
    if (n !== hex) map.set(hex, n);
  }
  return { map, shared };
}

/** `#abc` / `#AABBCC` written as a colour (not `&#123;`, not a `(#anchor)`). */
const HEX_IN_TEXT =
  /(?<![\w&(#])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;

/**
 * Replace exact matches of old brand colours in a slide source. The front
 * matter is left alone (template_apply owns those keys). The new hex keeps the
 * case the source used. Returns the text, the changes and the hex colours that
 * matched no old role.
 */
export function recolourText(
  text: string,
  file: string,
  map: Map<string, string>,
  skipFrontMatter = false,
): { text: string; changes: Recolour[]; other: string[] } {
  const lines = text.split("\n");
  let start = 0;
  if (skipFrontMatter && lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0) start = end + 1;
  }
  const changes: Recolour[] = [];
  const other = new Set<string>();
  for (let i = start; i < lines.length; i++) {
    lines[i] = lines[i].replace(HEX_IN_TEXT, (m) => {
      const n = map.get(normHex(m));
      if (!n) {
        other.add(normHex(m));
        return m;
      }
      const out = m === m.toLowerCase() ? n.toLowerCase() : n;
      changes.push({ file, line: i + 1, from: m, to: out });
      return out;
    });
  }
  return { text: lines.join("\n"), changes, other: [...other].sort() };
}

/** Lines deck_init makes sure the deck folder's .gitignore has. */
export const DECK_GITIGNORE = [".deck_backups/", ".deck_previews/", ".quarto/"];

/**
 * The deck folder's .gitignore with the edit-snapshot folder (and quarto's
 * cache) ignored; `cur` null means there is none yet. Returns null when
 * nothing needs adding. Existing lines are kept as they are.
 */
export function gitignoreWith(cur: string | null): string | null {
  const have = new Set(
    (cur ?? "").split("\n").map((l) => l.trim().replace(/^\//, "")),
  );
  const add = DECK_GITIGNORE.filter((l) =>
    !have.has(l) && !have.has(l.replace(/\/$/, ""))
  );
  if (!add.length) return null;
  const base = cur ?? "";
  const sep = base && !base.endsWith("\n") ? "\n" : "";
  return base + sep + add.join("\n") + "\n";
}

async function writeFiles(dir: string, files: Record<string, string>) {
  for (const [f, t] of Object.entries(files)) {
    await Deno.mkdir(pdir(pjoin(dir, f)), { recursive: true });
    await Deno.writeTextFile(pjoin(dir, f), t);
  }
}

/** Write a PNG as a swamp file and return its path on disk (if any). */
async function savePng(
  ctx: TemplateContext,
  spec: string,
  name: string,
  png: Uint8Array,
): Promise<{ handle: Handle; path: string }> {
  const w = ctx.createFileWriter(spec, name);
  if (w.getFilePath && w.finalize) {
    const path = await w.getFilePath();
    await Deno.writeFile(path, png);
    return { handle: await w.finalize(), path };
  }
  return { handle: await w.writeAll(png), path: "" };
}

const TemplateRecordSchema = z.object({
  method: z.string(),
  template: z.string(),
  main: z.string(),
  files: z.array(z.string()),
  changes: z.array(z.string()),
  dropped: z.array(z.string()),
  backup: z.string().nullable(),
  warnings: z.array(z.string()),
  /** template_apply recolour=true: every hex rewritten. */
  recoloured: z.array(z.object({
    file: z.string(),
    line: z.number(),
    from: z.string(),
    to: z.string(),
  })).optional(),
  at: z.string(),
});

const PreviewSchema = z.object({
  templates: z.array(z.object({
    name: z.string(),
    sheet: z.string(),
    slides: z.number(),
    overflowing: z.array(z.object({
      n: z.number(),
      title: z.string(),
      px: z.number(),
    })),
  })),
  gallery: z.string(),
  at: z.string(),
});

/** Resources the template methods write. */
export const templateResources = {
  template: {
    description:
      "Last deck_init / template_apply: template, files written, YAML changes, snapshot id",
    schema: TemplateRecordSchema,
    lifetime: "infinite" as const,
    garbageCollection: 20,
  },
  templates: {
    description: "The template library: name, description, palette, preview",
    schema: z.object({
      templates: z.array(z.object({
        name: z.string(),
        description: z.string(),
        palette: z.record(z.string(), z.unknown()),
        preview: z.string().nullable(),
        current: z.boolean(),
      })),
    }),
    lifetime: "infinite" as const,
    garbageCollection: 5,
  },
  templatePreview: {
    description: "Contact sheet per template and a side-by-side gallery",
    schema: PreviewSchema,
    lifetime: "infinite" as const,
    garbageCollection: 5,
  },
};

/** Files the template methods write. */
export const templateFileSpecs = {
  templateSheet: {
    description: "Template preview: contact sheet of the sample deck (PNG)",
    contentType: "image/png",
    lifetime: "infinite" as const,
    garbageCollection: 8,
  },
};

/** Public palette summary (hex per role). */
function paletteSummary(p: DeckPalette): Record<string, unknown> {
  return {
    primary: p.primary,
    good: p.good,
    bad: p.bad,
    muted: p.muted,
    background: p.background,
    foreground: p.foreground,
    accent: p.accent,
    section: p.section,
    titleSlide: p.titleSlide,
    fonts: p.fonts,
  };
}

/** Gallery HTML: one column per template, the same slides in each. */
export function galleryHtml(
  cols: Array<{ name: string; shots: string[] }>,
  tw = 384,
): string {
  const th = Math.round(tw * 9 / 16);
  const esc = (s: string) =>
    s.replace(/[<&>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const col = (c: { name: string; shots: string[] }) =>
    `<section><h1>${esc(c.name)}</h1>${
      c.shots.map((s) => `<img src="${esc(s)}">`).join("")
    }</section>`;
  return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#666;font:600 20px -apple-system,Helvetica,sans-serif}
main{display:flex;gap:10px;padding:10px}
section{display:flex;flex-direction:column;gap:8px}
h1{margin:0;font-size:22px;color:#fff;text-align:center;padding:4px 0}
img{width:${tw}px;height:${th}px;display:block;object-fit:contain;background:#fff}
</style><main>${cols.map(col).join("")}</main>`;
}

/** The template methods, for spreading into the model's `methods`. */
export function templateMethods(journal: JournalFn) {
  return {
    template_list: {
      description:
        "List the deck templates shipped with the extension: name, description, palette, the latest preview PNG; marks the one this deck uses",
      arguments: z.object({}),
      execute: async (_args: Record<string, never>, ctx: TemplateContext) => {
        const g = ctx.globalArgs;
        const main = await Deno.readTextFile(pjoin(g.dir, g.main)).catch(
          () => "",
        );
        const cur = main ? currentTemplate(main) : null;
        const prev = await ctx.readResource?.("templatePreview").catch(
          () => null,
        ) as z.infer<typeof PreviewSchema> | null;
        const rows = [];
        for (const name of TEMPLATE_NAMES) {
          const pal = brandPalette(templateBrand(name));
          const sheet = prev?.templates.find((t) => t.name === name)?.sheet;
          const preview = sheet && await exists(sheet) ? sheet : null;
          rows.push({
            name,
            description: TEMPLATES[name].description,
            palette: paletteSummary(pal),
            preview,
            current: name === cur,
          });
          ctx.logger.info(
            "{mark}{name}: {desc}\n   primary {p}, good {g}, bad {b}, bg {bg}{prev}",
            {
              mark: name === cur ? "* " : "  ",
              name,
              desc: TEMPLATES[name].description,
              p: pal.primary,
              g: pal.good,
              b: pal.bad,
              bg: pal.background,
              prev: preview ? `\n   preview ${preview}` : "",
            },
          );
        }
        const h = await ctx.writeResource("templates", "templates", {
          templates: rows,
        });
        return { dataHandles: [h] };
      },
    },

    deck_init: {
      description:
        "Start a new deck from a template: main .qmd with the template's YAML, a title slide and empty 'Learning outcomes' / 'Learning outcomes revisited' slides; theme files in theme/, _brand.yml next to it. Refuses to overwrite an existing file. Journals itself",
      arguments: z.object({
        template: TemplateNameSchema.default("neutral"),
        file: z.string().optional().describe(
          "Main .qmd relative to dir; default: the model's main",
        ),
        title: z.string(),
        subtitle: z.string().optional(),
        author: z.string().optional(),
        footer: z.string().optional(),
        logo: z.string().optional().describe(
          "Logo path relative to the deck (the wur template expects one; default assets/logo.png when that file exists)",
        ),
      }),
      execute: async (
        args: {
          template: TemplateName;
          file?: string;
          title: string;
          subtitle?: string;
          author?: string;
          footer?: string;
          logo?: string;
        },
        ctx: TemplateContext,
      ) => {
        const g = ctx.globalArgs;
        const main = args.file ?? g.main;
        const path = pjoin(g.dir, main);
        if (await exists(path)) {
          throw new Error(
            `${main} exists; deck_init only starts new decks (template_apply switches an existing one)`,
          );
        }
        const outputs = templateOutputs(args.template, main);
        const clash = [];
        for (const f of Object.keys(outputs)) {
          if (await exists(pjoin(g.dir, f))) clash.push(f);
        }
        const warnings: string[] = [];
        const def = TEMPLATES[args.template].logo;
        const brandLogo = templateBrand(args.template).logo;
        let logo = args.logo ?? brandLogo ?? undefined;
        if (!logo && def) {
          if (await exists(pjoin(g.dir, rel(main, def)))) logo = def;
          else {
            warnings.push(
              `template ${args.template} expects a logo; none at ${def} (pass logo=)`,
            );
          }
        }
        if (logo && !(await exists(pjoin(g.dir, rel(main, logo))))) {
          warnings.push(`logo ${logo} does not exist yet`);
        }
        const pal = brandPalette(templateBrand(args.template));
        const qmd = newDeckQmd({
          template: args.template,
          title: args.title,
          subtitle: args.subtitle,
          author: args.author,
          footer: args.footer,
          logo,
          titleBackground: pal.titleSlide,
        });
        // theme files that already exist (another deck in the folder) are
        // replaced only when they are the same template's
        const files: Record<string, string> = { [main]: qmd };
        for (const [f, t] of Object.entries(outputs)) {
          if (clash.includes(f)) {
            const cur = await Deno.readTextFile(pjoin(g.dir, f));
            if (cur !== t) {
              warnings.push(
                `${f} exists with other content; kept (run template_apply to replace it)`,
              );
            }
            continue;
          }
          files[f] = t;
        }
        const ignore = await Deno.readTextFile(pjoin(g.dir, ".gitignore"))
          .catch(() => null);
        const ignoreNew = gitignoreWith(ignore);
        if (ignoreNew !== null) files[".gitignore"] = ignoreNew;
        await writeFiles(g.dir, files);
        for (const w of warnings) ctx.logger.info("warning: {w}", { w });
        ctx.logger.info("deck_init {t}: wrote {files}", {
          t: args.template,
          files: Object.keys(files).join(", "),
        });
        const h = await ctx.writeResource("template", "template", {
          method: "deck_init",
          template: args.template,
          main,
          files: Object.keys(files),
          changes: [],
          dropped: [],
          backup: null,
          warnings,
          at: new Date().toISOString(),
        });
        const j = await journal(ctx, {
          kind: "change",
          text: `deck_init: new deck ${main} from template ${args.template}`,
          ref: Object.keys(files).join(", "),
        });
        return { dataHandles: [h, j] };
      },
    },

    template_apply: {
      description:
        "Switch an existing deck to another template: snapshot, then replace theme/<template>.scss, theme/deck-base.html and _brand.yml, and rewrite only the template-owned YAML keys (theme, include-in-header, title-slide background; logo and footer when given). Content is untouched unless recolour=true (old brand hex in the slide sources -> new brand hex, exact matches only); restore id= undoes it. Journals itself",
      arguments: z.object({
        template: TemplateNameSchema,
        logo: z.string().optional().describe(
          "Set the logo; default: keep the deck's logo",
        ),
        footer: z.string().optional().describe(
          "Set the footer; default: keep the deck's footer",
        ),
        keepBrand: z.boolean().default(false).describe(
          "Keep the deck's own _brand.yml (edited colours) and regenerate the theme from it",
        ),
        recolour: z.boolean().default(false).describe(
          "Also rewrite hex colours in the slide sources (inline SVG, style=) that exactly equal an old brand role colour to the new brand's colour for that role; others are listed, not changed",
        ),
      }),
      execute: async (
        args: {
          template: TemplateName;
          logo?: string;
          footer?: string;
          keepBrand: boolean;
          recolour: boolean;
        },
        ctx: TemplateContext,
      ) => {
        const g = ctx.globalArgs;
        const mainPath = pjoin(g.dir, g.main);
        const before = await Deno.readTextFile(mainPath);
        const brandFile = rel(g.main, "_brand.yml");
        // the brand the slides were drawn with: the deck's _brand.yml, else
        // the template its YAML names
        const oldBrandText = await Deno.readTextFile(pjoin(g.dir, brandFile))
          .catch(() => null);
        const oldName = currentTemplate(before);
        const oldPal = oldBrandText !== null
          ? brandPalette(parseBrand(oldBrandText))
          : oldName
          ? brandPalette(templateBrand(oldName))
          : null;
        let brandText: string | undefined;
        if (args.keepBrand) {
          brandText = await Deno.readTextFile(pjoin(g.dir, brandFile)).catch(
            () => {
              throw new Error(`keepBrand: ${brandFile} does not exist`);
            },
          );
        }
        const outputs = templateOutputs(args.template, g.main, brandText);
        const pal = brandPalette(
          parseBrand(outputs[brandFile]),
        );
        const rw = applyTemplateKeys(before, {
          theme: themeScss(args.template),
          include: BASE_HTML,
          logo: args.logo,
          footer: args.footer,
          titleBackground: pal.titleSlide,
        });
        const warnings: string[] = [];
        // classes only the dropped include defined would lose their style
        const have = new Set([
          ...cssClasses(outputs[rel(g.main, BASE_HTML)]),
          ...cssClasses(outputs[rel(g.main, themeScss(args.template))]),
        ]);
        for (const d of rw.dropped.filter((x) => x !== BASE_HTML)) {
          const old = await Deno.readTextFile(pjoin(g.dir, rel(g.main, d)))
            .catch(() => "");
          const lost = [...cssClasses(old)].filter((c) => !have.has(c));
          if (lost.length) {
            warnings.push(
              `${d} is no longer included; classes it styled that the template does not: ${
                lost.join(", ")
              } (copy them into a header include of your own)`,
            );
          }
        }
        const logoNow = currentTemplateKeys(rw.text).logo;
        if (TEMPLATES[args.template].logo && !logoNow) {
          warnings.push(
            `template ${args.template} expects a logo (pass logo=)`,
          );
        }
        const files: Record<string, string> = {
          ...outputs,
          [g.main]: rw.text,
        };
        const recoloured: Recolour[] = [];
        if (args.recolour) {
          if (!oldPal) {
            warnings.push(
              "recolour: no _brand.yml and no known template in the YAML; colours left as they are",
            );
          } else {
            const { map, shared } = colourMap(oldPal, pal);
            for (const x of shared) {
              warnings.push(
                `recolour: ${x.hex} is ${
                  x.roles.join(" / ")
                } in the old brand; mapped as ${x.as} -> ${
                  map.get(x.hex) ?? x.hex
                } (check slides that used it as another role)`,
              );
            }
            const other = new Set<string>();
            for (const f of outlineDeck(g.dir, g.main).files) {
              const text = f === g.main
                ? rw.text
                : await Deno.readTextFile(pjoin(g.dir, f));
              const r = recolourText(text, f, map, f === g.main);
              r.other.forEach((x) => other.add(x));
              if (r.changes.length) {
                files[f] = r.text;
                recoloured.push(...r.changes);
              }
            }
            if (other.size) {
              ctx.logger.info(
                "recolour: {n} other hex colours are no brand colour and stay: {list}",
                { n: other.size, list: [...other].sort().join(", ") },
              );
            }
          }
        }
        const backup: Backup = await snapshot(
          g.dir,
          Object.keys(files),
          "template_apply",
          `before template_apply ${args.template}`,
        );
        const order = outlineDeck(g.dir, g.main).slides.map((s) =>
          `${s.file}:${s.title}`
        );
        try {
          await writeFiles(g.dir, files);
          const after = outlineDeck(g.dir, g.main).slides.map((s) =>
            `${s.file}:${s.title}`
          );
          if (JSON.stringify(after) !== JSON.stringify(order)) {
            throw new Error("the slide order changed");
          }
        } catch (e) {
          await putBack(g.dir, backup);
          throw new Error(
            `template_apply failed (${
              (e as Error).message
            }); files restored from ${backup.id}`,
          );
        }
        for (const c of rw.changes) ctx.logger.info("  {c}", { c });
        for (const c of recoloured) {
          ctx.logger.info("  recolour {file}:{line} {from} -> {to}", { ...c });
        }
        for (const w of warnings) ctx.logger.info("warning: {w}", { w });
        ctx.logger.info(
          "template_apply {t}: wrote {files}; snapshot {id} (restore id={id} undoes it)",
          {
            t: args.template,
            files: Object.keys(files).join(", "),
            id: backup.id,
          },
        );
        const h = await ctx.writeResource("template", "template", {
          method: "template_apply",
          template: args.template,
          main: g.main,
          files: Object.keys(files),
          changes: rw.changes,
          dropped: rw.dropped,
          backup: backup.id,
          warnings,
          ...(args.recolour ? { recoloured } : {}),
          at: new Date().toISOString(),
        });
        const j = await journal(ctx, {
          kind: "change",
          text: `template_apply: ${args.template}${
            args.keepBrand ? " (own _brand.yml kept)" : ""
          }; ${rw.changes.join("; ") || "YAML unchanged"}${
            args.recolour
              ? `; recolour: ${recoloured.length} colours in ${
                new Set(recoloured.map((c) => c.file)).size
              } files`
              : ""
          }`,
          ref: `backup ${backup.id}`,
        });
        return { dataHandles: [h, j] };
      },
    },

    template_preview: {
      description:
        "Render a built-in sample deck (title, section, statement, paper slide, each diagram pattern, learning outcomes) once per template in a temp dir; one contact sheet per template plus a side-by-side gallery PNG. Returns the paths",
      arguments: z.object({
        templates: z.array(TemplateNameSchema).optional().describe(
          "Default: all",
        ),
      }),
      execute: async (
        args: { templates?: TemplateName[] },
        ctx: TemplateContext,
      ) => {
        const g = ctx.globalArgs;
        const names = args.templates?.length ? args.templates : TEMPLATE_NAMES;
        const root = await Deno.makeTempDir({ prefix: "quarto-deck-tpl-" });
        const handles: Handle[] = [];
        const rows: z.infer<typeof PreviewSchema>["templates"] = [];
        const cols: Array<{ name: string; shots: string[] }> = [];
        try {
          for (const name of names) {
            const dir = `${root}/${name}`;
            const outputs = templateOutputs(name, "sample.qmd");
            const pal = brandPalette(templateBrand(name));
            await writeFiles(dir, {
              ...outputs,
              "sample.qmd": sampleDeck(name, pal),
              "figure.svg": templateFile("sample/figure.svg"),
              "backdrop.svg": templateFile("sample/backdrop.svg"),
            });
            await renderDeck({ dir, main: "sample.qmd", quarto: g.quarto });
            const { check, shots } = await checkDeck({
              html: `${dir}/sample.html`,
              chrome: g.chrome,
            });
            const titles = check.slides.map((s) => s.title);
            const [sheet] = await contactSheets(shots, titles, {
              chrome: g.chrome,
              cols: 3,
              rows: Math.ceil(shots.length / 3),
            });
            const saved = await savePng(
              ctx,
              "templateSheet",
              `template-${name}`,
              sheet,
            );
            handles.push(saved.handle);
            shots.forEach((s, i) =>
              Deno.writeFileSync(`${root}/${name}-${i + 1}.jpg`, s)
            );
            cols.push({
              name,
              shots: shots.map((_, i) => `${name}-${i + 1}.jpg`),
            });
            rows.push({
              name,
              sheet: saved.path,
              slides: check.slideCount,
              overflowing: check.overflowing.map((o) => ({
                n: o.n,
                title: o.title,
                px: o.overflowPx,
              })),
            });
            ctx.logger.info("{name}: {n} slides, {o} overflowing\n   {sheet}", {
              name,
              n: check.slideCount,
              o: check.overflowing.length,
              sheet: saved.path,
            });
          }
          // gallery: one column per template, the same slides side by side
          const tw = 384, th = 216;
          const n = Math.max(...cols.map((c) => c.shots.length));
          const width = cols.length * (tw + 10) + 10;
          const height = 10 + 38 + n * (th + 8) + 10;
          await Deno.writeTextFile(
            `${root}/gallery.html`,
            galleryHtml(cols, tw),
          );
          const page = await launchChrome(g.chrome, { width, height });
          let png: Uint8Array;
          try {
            await page.goto(`file://${root}/gallery.html`);
            await new Promise((r) => setTimeout(r, 400));
            png = await page.screenshot("png");
          } finally {
            await page.close();
          }
          const gal = await savePng(
            ctx,
            "templateSheet",
            "template-gallery",
            png,
          );
          handles.push(gal.handle);
          ctx.logger.info("gallery {path}", { path: gal.path });
          handles.unshift(
            await ctx.writeResource("templatePreview", "templatePreview", {
              templates: rows,
              gallery: gal.path,
              at: new Date().toISOString(),
            }),
          );
        } finally {
          await Deno.remove(root, { recursive: true }).catch(() => {});
        }
        return { dataHandles: handles };
      },
    },
  };
}
