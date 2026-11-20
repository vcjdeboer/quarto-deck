/**
 * Bring the references of existing paper slides into house style: the `.src`
 * line and the notes `Ref:` line are rebuilt from the paper's metadata (the
 * `.json` next to its PDF), keeping the figure part of the `.src` line
 * ("Fig. 2A,B. Skin fibroblasts").
 * @module
 */

/** Where the figure part of an old `.src` line starts (", Fig. 2A"). */
const DETAIL_RE =
  /[,.;]\s*(?=(?:Fig\.?|Figs\.?|Figure|Table|Supp\w*|Extended|Movie|Box|Scheme)\b)/i;

/** The figure part of a `.src` text, with its leading ", "; "" when none. */
export function srcDetail(src: string): string {
  const m = src.match(DETAIL_RE);
  if (!m || m.index === undefined) return "";
  return `, ${src.slice(m.index + m[0].length).trim()}`;
}

/** One rewritten line (0-based index in the file). */
export interface RefChange {
  line: number;
  from: string;
  to: string;
}

/**
 * Rewrite the `.src` line(s) and the `Ref:` line of one slide (lines
 * `start`..`end` of a file). A `Ref:` that wraps over several lines is
 * replaced as a whole. Returns the new lines and the changes.
 */
export function refreshRefs(
  lines: string[],
  start: number,
  end: number,
  base: string,
  reference: string,
  doi: string,
): { lines: string[]; changes: RefChange[] } {
  const out = [...lines];
  const changes: RefChange[] = [];
  for (let i = end - 1; i >= start; i--) {
    const l = out[i];
    const src = l.match(/^(\s*)\[(.*)\]\{\.src\b([^}]*)\}\s*$/);
    if (src) {
      const to = `${src[1]}[${base}${srcDetail(src[2])}]{.src${src[3]}}`;
      if (to !== l) {
        changes.push({ line: i, from: l, to });
        out[i] = to;
      }
      continue;
    }
    if (/^\s*Ref(?:erence)?s?:/i.test(l)) {
      let j = i + 1;
      while (
        j < end && out[j].trim() !== "" &&
        !/^\s*(CHECK:|:{3,}|~|Ref(?:erence)?s?:|doi:)/i.test(out[j])
      ) j++;
      const from = out.slice(i, j).join("\n");
      const to = `Ref: ${reference.replace(/[.\s]+$/, "")}, doi:${doi}.`;
      if (from !== to) {
        changes.push({ line: i, from, to });
        out.splice(i, j - i, to);
      }
    }
  }
  return { lines: out, changes: changes.reverse() };
}

/**
 * Replace the first numbered list (`1. …`, continuation lines included) in
 * lines `start`..`end` with `items`, numbered from 1. Throws when the slide has
 * no numbered list.
 */
export function replaceNumberedList(
  lines: string[],
  start: number,
  end: number,
  items: string[],
): string[] {
  let a = -1;
  for (let i = start; i < end; i++) {
    if (/^\s*\d+[.)]\s+\S/.test(lines[i])) {
      a = i;
      break;
    }
  }
  if (a < 0) throw new Error(`no numbered list between lines ${start + 1} and ${end}`);
  let b = a + 1;
  while (
    b < end && lines[b].trim() !== "" && !/^\s*:{3,}/.test(lines[b])
  ) b++;
  const indent = lines[a].match(/^\s*/)![0];
  const out = [...lines];
  out.splice(a, b - a, ...items.map((t, k) => `${indent}${k + 1}. ${t.trim()}`));
  return out;
}
