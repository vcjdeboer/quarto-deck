/**
 * The house slide patterns as code, so every deck gets them the same way:
 *
 * - paper: title = the message, ONE figure from ONE source, one `.src` line,
 *   speaker notes with timing, the story and the full reference + DOI. No
 *   bullet builds.
 * - section: dark divider with a one-line subtitle.
 * - statement: one big sentence.
 *
 * Plus inserting the markdown into a section file (append, or after the slide
 * whose title contains a given text).
 * @module
 */

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
  const ref = [s.reference ?? s.citation, s.doi ? `doi:${s.doi}` : ""].filter(
    Boolean,
  )
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
  color = "#12384A",
): string {
  return [
    `# ${title} {.section .center background-color="${color}"}`,
    "",
    ...(subtitle ? [subtitle, ""] : []),
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
