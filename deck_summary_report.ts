/**
 * @vcjdeboer/quarto-deck/deck-summary — the state of a deck in one page: time
 * budget against the slot, open CHECKs, overflow, where every figure came
 * from (paper, page, crop box, DOI), the references in the notes, the last
 * build and exports, and the build journal.
 *
 * Reads only the deck model's own swamp data.
 * @module
 */

/** Minimal data-repository surface used here (mirrors ReportContext). */
export interface RepoLike {
  getContent(
    type: string,
    modelId: string,
    dataName: string,
    version?: number,
  ): Promise<Uint8Array | null>;
  findAllForModel(
    type: string,
    modelId: string,
  ): Promise<
    Array<{ name: string; version: number; tags?: Record<string, string> }>
  >;
}

/** Report context fields used here. */
export interface SummaryContext {
  modelType: string;
  modelId: string;
  dataRepository: RepoLike;
}

/** Report output. */
export interface ReportResult {
  markdown: string;
  json: Record<string, unknown>;
}

type Rec = Record<string, unknown>;

/** Everything the summary is built from (latest version of each item). */
export interface DeckData {
  outline?: Rec;
  build?: Rec;
  check?: Rec;
  pdfInfo?: Rec;
  pptxInfo?: Rec;
  journal?: { entries: Array<Rec> };
  figures: Rec[];
  sources: Rec[];
  /** figure_from_image records (screenshots, publisher figures, photos). */
  images?: Rec[];
}

/** Slide-counter number when the outline has it (older outlines: source n). */
const num = (x: { slide: number; shown?: number | null }) =>
  x.shown === undefined
    ? String(x.slide)
    : x.shown === null
    ? `hidden (source ${x.slide})`
    : String(x.shown);

const esc = (s: unknown) =>
  String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Build the markdown and json summary (pure). */
export function summarize(d: DeckData, journalTail = 15): ReportResult {
  const md: string[] = [];
  const o = d.outline as
    | {
      title: string | null;
      visibleSlides: number;
      hiddenSlides: number;
      minutesPlanned: number;
      slotMinutes: number | null;
      notesCoverage: number;
      untimedVisible: number[];
      checks: Array<{ slide: number | null; file: string; text: string }>;
      missingImages: Array<{ slide: number; path: string }>;
      missingIncludes?: string[];
      dois: string[];
      slides: Array<
        { n: number; title: string; hidden: boolean; minutes: number | null }
      >;
      sections?: Array<
        { title: string; slide: number | null; slides: number; minutes: number }
      >;
      styleIssues?: Array<
        {
          slide: number;
          shown?: number | null;
          title: string;
          rule: string;
          level?: string;
          message: string;
          id?: string;
          file?: string;
          line?: number;
        }
      >;
      suppressed?: Array<
        { slide: number; shown?: number | null; id?: string; rule: string }
      >;
      outcomes?: {
        opening: number | null;
        closing: number | null;
        match: boolean | null;
        differences: string[];
        items: Array<{
          n: number;
          terms: Array<{ term: string; slides: number[] }>;
          slides: number[];
        }>;
      } | null;
      cut?: {
        slotMinutes: number | null;
        overSlot: number | null;
        sections: Array<{
          title: string;
          slides: number;
          minutes: number;
          share: number | null;
          longest: Array<{ slide: number; title: string; minutes: number }>;
        }>;
      };
    }
    | undefined;
  md.push(`# ${o?.title ?? "Deck"} — summary`, "");
  const json: Record<string, unknown> = {};
  if (o) {
    const over = o.slotMinutes ? o.minutesPlanned - o.slotMinutes : null;
    const verdict = over === null
      ? ""
      : over > 0
      ? ` — **${over.toFixed(1)} min over**`
      : ` — ${(-over).toFixed(1)} min spare`;
    md.push(
      "## Time budget",
      "",
      `${o.minutesPlanned} min planned in the notes` +
        (o.slotMinutes ? ` for a ${o.slotMinutes} min slot${verdict}` : "") +
        ".",
      `${o.visibleSlides} visible slides (+${o.hiddenSlides} hidden); notes on ${
        Math.round(o.notesCoverage * 100)
      }%` + (o.untimedVisible.length
        ? `; no timing on slides ${o.untimedVisible.join(", ")}`
        : "") +
        ".",
      "",
    );
    const secs = o.sections ?? [];
    const cut = o.cut;
    if (cut && cut.sections.length) {
      md.push(
        "### Where the time goes",
        "",
        "| section | slides | min | share of slot | longest slides |",
        "|---|---|---|---|---|",
      );
      for (const x of cut.sections) {
        md.push(
          `| ${esc(x.title)} | ${x.slides} | ${x.minutes} | ${
            x.share === null ? "" : `${Math.round(x.share * 100)}%`
          } | ${
            esc(
              x.longest.map((l) =>
                `${l.minutes}' ${l.title}`
              ).join("; "),
            )
          } |`,
        );
      }
      md.push("");
      if (cut.overSlot !== null && cut.overSlot > 0) {
        md.push(`Cut **${cut.overSlot} min** to fit the slot.`, "");
      }
      json.overSlot = cut.overSlot;
    } else if (secs.length > 1) {
      md.push("| section | slides | min |", "|---|---|---|");
      for (const x of secs) {
        md.push(`| ${esc(x.title)} | ${x.slides} | ${x.minutes} |`);
      }
      md.push("");
    }
    json.minutesPlanned = o.minutesPlanned;
    json.slotMinutes = o.slotMinutes;
    json.visibleSlides = o.visibleSlides;
    const missingIncludes = o.missingIncludes ?? [];
    if (o.checks.length || o.missingImages.length || missingIncludes.length) {
      md.push("## Open items", "");
      for (const m of missingIncludes) {
        md.push(`- missing file: \`${m}\``);
      }
      for (const c of o.checks) {
        const t = c.slide ? o.slides.find((s) => s.n === c.slide)?.title : "";
        md.push(`- CHECK (${c.file}${t ? `, “${t}”` : ""}): ${c.text}`);
      }
      for (const m of o.missingImages) {
        md.push(`- missing image on slide ${m.slide}: \`${m.path}\``);
      }
      md.push("");
    }
    const style = o.styleIssues ?? [];
    const rules = style.filter((x) => x.level !== "hint");
    const hints = style.filter((x) => x.level === "hint");
    const suppressed = o.suppressed ?? [];
    if (style.length || suppressed.length) {
      md.push("## House style", "");
      for (const x of rules) {
        const where = x.file ? ` (${x.file}:${x.line})` : "";
        const id = x.id ? `[${x.id}] ` : "";
        md.push(
          `- ${id}slide ${num(x)} “${esc(x.title)}”${where}: ${x.message}`,
        );
      }
      const byRule = new Map<string, typeof hints>();
      for (const h of hints) {
        byRule.set(h.message, [...(byRule.get(h.message) ?? []), h]);
      }
      for (const [msg, hs] of byRule) {
        md.push(
          `- hint (${hs.length}): ${msg} — slides ${hs.map(num).join(", ")}`,
        );
      }
      if (suppressed.length) {
        md.push(
          `- suppressed with lint-ignore (${suppressed.length}): ${
            suppressed.map((x) => `slide ${num(x)} ${x.id ?? x.rule}`).join(
              ", ",
            )
          }`,
        );
      }
      md.push("");
    }
    const lo = o.outcomes;
    if (lo && lo.items.length) {
      md.push(
        "## Learning outcomes",
        "",
        lo.match === null
          ? "Only one outcome list in the deck."
          : lo.match
          ? "Opening and closing lists match."
          : `**Opening and closing lists differ** (${lo.differences.length}).`,
        "",
        "| # | key terms | slides |",
        "|---|---|---|",
      );
      for (const it of lo.items) {
        md.push(
          `| ${it.n} | ${esc(it.terms.map((t) => t.term).join(", "))} | ${
            it.slides.length ? it.slides.join(", ") : "**none**"
          } |`,
        );
      }
      md.push("");
      json.outcomesMatch = lo.match;
    }
    json.styleSuppressed = suppressed.length;
    json.styleIssues = rules.length;
    json.styleHints = hints.length;
    json.checks = o.checks.length;
    json.missingImages = o.missingImages.length;
  }
  const c = d.check as
    | {
      slideCount: number;
      overflowing: Array<{ n: number; title: string; overflowPx: number }>;
      logoOverlaps?: Array<
        {
          n: number;
          title: string;
          logoOverlapPx?: number;
          logoOverlapElement?: string;
        }
      >;
    }
    | undefined;
  if (c) {
    md.push(
      "## Rendered deck",
      "",
      `${c.slideCount} slides, ${c.overflowing.length} overflowing.`,
      ...c.overflowing.map((s) =>
        `- slide ${s.n} “${s.title}” overflows by ${s.overflowPx}px`
      ),
      ...(c.logoOverlaps ?? []).map((s) =>
        `- slide ${s.n} “${s.title}”: ${
          s.logoOverlapElement || "a figure"
        } runs under the logo (${s.logoOverlapPx}px)`
      ),
      "",
    );
    json.overflowing = c.overflowing.length;
    json.logoOverlaps = (c.logoOverlaps ?? []).length;
  }
  // only crops that a slide shows; earlier crops and previews are counted
  const shownImages = new Set(
    ((o?.slides ?? []) as Array<{ images?: string[] }>).flatMap((s) =>
      s.images ?? []
    ),
  );
  const onSlide = (f: Rec) =>
    !o || shownImages.size === 0 || shownImages.has(String(f.path));
  const usedFigures = d.figures.filter(onSlide);
  const unusedFigures = d.figures.length - usedFigures.length;
  if (d.figures.length) {
    md.push(
      "## Figure provenance",
      "",
      "| image | source | page | box (pt) | dpi | DOI |",
      "|---|---|---|---|---|---|",
    );
    for (const f of usedFigures) {
      const b = f.boxPt as { x: number; y: number; w: number; h: number };
      md.push(
        `| \`${esc(f.path)}\` | ${esc(f.citation)} | ${f.page} | ${
          Math.round(b.x)
        },${Math.round(b.y)} ${Math.round(b.w)}×${
          Math.round(b.h)
        } | ${f.dpi} | ${esc(f.doi ?? "")} |`,
      );
    }
    if (unusedFigures) {
      md.push(
        "",
        `${unusedFigures} more crop(s) on no slide (earlier versions or not used).`,
      );
    }
    md.push("");
    json.figures = usedFigures.length;
    json.figuresUnused = unusedFigures;
  }
  if (d.images?.length) {
    md.push(
      "## Images (not from a paper PDF)",
      "",
      "| image | original | box (px) | credit | rights |",
      "|---|---|---|---|---|",
    );
    for (const f of d.images) {
      const b = f.boxPx as
        | { x: number; y: number; w: number; h: number }
        | null;
      md.push(
        `| \`${esc(f.path)}\` | ${
          esc(String(f.original ?? "").split("/").pop())
        } | ${b ? `${b.x},${b.y} ${b.w}×${b.h}` : "whole"} | ${
          esc(f.credit)
        } | ${esc(f.rights ?? "")} |`,
      );
    }
    md.push("");
    json.images = d.images.length;
  }
  if (o?.dois.length) {
    md.push(
      "## References in the notes",
      "",
      ...o.dois.map((x) => `- https://doi.org/${x}`),
      "",
    );
  }
  const b = d.build as
    | {
      renderedAt: string;
      seconds: number;
      quartoVersion: string;
      rVersion: string;
      warnings: string[];
    }
    | undefined;
  const p = d.pdfInfo as
    | {
      path: string;
      pages: number;
      bytes: number;
      parts?: Array<{ path: string; pages: number; bytes: number }>;
    }
    | undefined;
  const x = d.pptxInfo as
    | { path: string; slides: number; bytes: number }
    | undefined;
  if (b || p || x) {
    md.push("## Builds and exports", "");
    if (b) {
      md.push(
        `- render ${b.renderedAt} (${b.seconds}s), Quarto ${b.quartoVersion}, ${b.rVersion}` +
          (b.warnings.length ? `, ${b.warnings.length} warnings` : ""),
      );
    }
    for (const q of p?.parts?.length ? p.parts : p ? [p] : []) {
      md.push(
        `- PDF \`${q.path}\`: ${q.pages} pages, ${
          (q.bytes / 1e6).toFixed(1)
        } MB`,
      );
    }
    if (x) {
      md.push(
        `- PPTX \`${x.path}\`: ${x.slides} slides, ${
          (x.bytes / 1e6).toFixed(1)
        } MB`,
      );
    }
    md.push("");
  }
  const entries = d.journal?.entries ?? [];
  if (entries.length) {
    md.push(
      `## Build journal (last ${
        Math.min(journalTail, entries.length)
      } of ${entries.length})`,
      "",
    );
    for (const e of entries.slice(-journalTail)) {
      md.push(
        `- ${String(e.at).slice(0, 16).replace("T", " ")} **${e.kind}**` +
          (e.slide ? ` “${e.slide}”` : "") + `: ${e.text}`,
      );
    }
    md.push("");
    json.journalEntries = entries.length;
  }
  json.sources = d.sources.length;
  return { markdown: md.join("\n"), json };
}

/** Read the latest version of every data item of the deck model. */
export async function loadDeckData(ctx: SummaryContext): Promise<DeckData> {
  const all = await ctx.dataRepository.findAllForModel(
    ctx.modelType,
    ctx.modelId,
  );
  const latest = new Map<string, number>();
  for (const it of all) {
    latest.set(it.name, Math.max(latest.get(it.name) ?? 0, it.version));
  }
  const read = async (name: string): Promise<Rec | undefined> => {
    const v = latest.get(name);
    if (v === undefined) return undefined;
    const raw = await ctx.dataRepository.getContent(
      ctx.modelType,
      ctx.modelId,
      name,
      v,
    );
    if (!raw) return undefined;
    try {
      return JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return undefined;
    }
  };
  const many = async (prefix: string) =>
    (await Promise.all(
      [...latest.keys()].filter((n) => n.startsWith(prefix)).sort().map(read),
    )).filter((r): r is Rec => !!r);
  return {
    outline: await read("outline"),
    build: await read("build"),
    check: await read("check"),
    pdfInfo: await read("pdf-info"),
    pptxInfo: await read("pptx-info"),
    journal: await read("journal") as { entries: Rec[] } | undefined,
    figures: await many("figure-"),
    sources: await many("source-"),
    images: await many("image-"),
  };
}

/** Report definition. */
export const report = {
  name: "@vcjdeboer/quarto-deck/deck-summary",
  description:
    "Deck state on one page: time budget vs slot, open CHECKs, overflow, figure provenance, references, builds/exports and the build journal",
  scope: "method" as const,
  labels: ["presentation", "summary"],
  execute: async (ctx: SummaryContext): Promise<ReportResult> => {
    // modelType is a ModelType object at runtime; compare its string form
    if (!String(ctx.modelType).startsWith("@vcjdeboer/quarto-deck")) {
      return { markdown: "", json: {} };
    }
    return summarize(await loadDeckData(ctx));
  },
};
