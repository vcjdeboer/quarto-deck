/**
 * The deck's visual identity, read from Quarto's `_brand.yml` next to the main
 * `.qmd`: palette, the named colour roles (primary, success, danger,
 * foreground, background), logo and fonts. `brandPalette()` maps those onto
 * the roles the slide patterns use (neutral → primary, good → success,
 * bad → danger, muted → a grey), so a diagram gets the deck's colours and no
 * code path hard-codes a house colour. Without a `_brand.yml` the neutral
 * defaults apply.
 *
 * Recognised palette names beyond Quarto's roles (all optional; derived when
 * absent): `muted`/`grey`/`gray`, `accent`, `accent-ink`, `ink` (text in
 * diagram boxes), `surface` (box fill), `pill`, `highlight`, `rule`,
 * `section` (divider background), `on-primary`, `on-section`, `title-slide`,
 * `tint-good`, `tint-bad`, `tint-neutral`, `tint-muted`.
 * @module
 */
import { parse as parseYaml } from "jsr:@std/yaml@1.1.2";

/** Colour roles of the diagram patterns. */
export type Role = "good" | "bad" | "neutral" | "muted";

/** Everything the slide patterns and theme files need, as hex. */
export interface DeckPalette {
  primary: string;
  onPrimary: string;
  good: string;
  bad: string;
  muted: string;
  /** Text inside diagram boxes. */
  ink: string;
  /** Fill of diagram boxes. */
  surface: string;
  pill: string;
  /** Bold words on a statement_image slide. */
  highlight: string;
  background: string;
  foreground: string;
  accent: string;
  accentInk: string;
  /** Hairlines (table rules). */
  rule: string;
  /** Section divider background. */
  section: string;
  onSection: string;
  /** Title slide background; null = the deck background. */
  titleSlide: string | null;
  tints: Record<Role, string>;
  fonts: { base: string | null; headings: string | null };
}

/** What `_brand.yml` holds that the extension reads. */
export interface Brand {
  name: string | null;
  palette: Record<string, string>;
  roles: Record<string, string>;
  logo: string | null;
  fonts: { base: string | null; headings: string | null };
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` → `#AABBCC`; throws on anything else. */
export function normHex(c: string): string {
  const s = c.trim();
  if (!HEX.test(s)) throw new Error(`not a hex colour: "${c}"`);
  const h = s.slice(1);
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  return `#${full.toUpperCase()}`;
}

function rgb(hex: string): [number, number, number] {
  const h = normHex(hex).slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** `a` mixed into `b`: weight 1 = all `a`. */
export function mix(a: string, b: string, weight: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return "#" +
    x.map((v, i) =>
      Math.round(v * weight + y[i] * (1 - weight)).toString(16).padStart(
        2,
        "0",
      )
    ).join("").toUpperCase();
}

/** WCAG relative luminance (0 black … 1 white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** True for a background that wants light text. */
export function isDark(hex: string): boolean {
  return contrast(hex, "#FFFFFF") > contrast(hex, "#1A1A1A");
}

/** Light or dark text, whichever reads better on `bg`. */
export function textOn(bg: string): string {
  return isDark(bg) ? "#FFFFFF" : "#1A1A1A";
}

/** Read a `_brand.yml` text. Unknown keys are ignored. */
export function parseBrand(text: string): Brand {
  const y = (parseYaml(text) ?? {}) as Record<string, unknown>;
  const color = (y.color ?? {}) as Record<string, unknown>;
  const pal = (color.palette ?? {}) as Record<string, unknown>;
  const palette: Record<string, string> = {};
  for (const [k, v] of Object.entries(pal)) {
    if (typeof v === "string") palette[k] = v;
  }
  const roles: Record<string, string> = {};
  for (const [k, v] of Object.entries(color)) {
    if (k !== "palette" && typeof v === "string") roles[k] = v;
  }
  let logo: string | null = null;
  if (typeof y.logo === "string") logo = y.logo;
  else if (y.logo && typeof y.logo === "object") {
    const l = y.logo as Record<string, unknown>;
    const pick = l.medium ?? l.large ?? l.small;
    if (typeof pick === "string") logo = pick;
    else if (pick && typeof pick === "object") {
      const p = (pick as Record<string, unknown>).light ??
        (pick as Record<string, unknown>).path;
      if (typeof p === "string") logo = p;
    }
  }
  const typo = (y.typography ?? {}) as Record<string, unknown>;
  const family = (v: unknown): string | null =>
    typeof v === "string" ? v : v && typeof v === "object" &&
        typeof (v as Record<string, unknown>).family === "string"
      ? (v as Record<string, string>).family
      : null;
  const meta = (y.meta ?? {}) as Record<string, unknown>;
  return {
    name: typeof meta.name === "string" ? meta.name : null,
    palette,
    roles,
    logo,
    fonts: { base: family(typo.base), headings: family(typo.headings) },
  };
}

/** The look a deck gets without `_brand.yml`: the `neutral` template. */
export const NEUTRAL_DEFAULTS = {
  primary: "#1D4E89",
  success: "#2F7A3D",
  danger: "#B3261E",
  muted: "#5F6B7A",
  foreground: "#1F2328",
  background: "#FFFFFF",
} as const;

/**
 * Resolve a colour value: a hex, or a palette name (also a role name such as
 * `primary`), following references a few levels deep.
 */
export function resolveColour(
  b: Brand | null,
  value: string | undefined,
): string | null {
  let v = value?.trim();
  for (let i = 0; v && i < 6; i++) {
    if (HEX.test(v)) return normHex(v);
    v = b?.palette[v] ?? b?.roles[v];
  }
  return null;
}

/** Map a brand (or none) onto the pattern roles and theme values. */
export function brandPalette(b: Brand | null): DeckPalette {
  const p = (name: string) => resolveColour(b, b?.palette[name]);
  const r = (name: string) => resolveColour(b, b?.roles[name]);
  const background = r("background") ?? NEUTRAL_DEFAULTS.background;
  const foreground = r("foreground") ?? NEUTRAL_DEFAULTS.foreground;
  const primary = r("primary") ?? NEUTRAL_DEFAULTS.primary;
  const good = r("success") ?? p("good") ?? NEUTRAL_DEFAULTS.success;
  const bad = r("danger") ?? p("bad") ?? NEUTRAL_DEFAULTS.danger;
  const dark = isDark(background);
  const muted = p("muted") ?? p("grey") ?? p("gray") ?? r("secondary") ??
    (b ? mix(foreground, background, 0.6) : NEUTRAL_DEFAULTS.muted);
  const surface = p("surface") ??
    (dark ? mix(foreground, background, 0.08) : "#FFFFFF");
  const accent = p("accent") ?? primary;
  const section = p("section") ?? primary;
  const tint = (role: Role, ink: string) =>
    p(`tint-${role}`) ?? mix(ink, surface, dark ? 0.18 : 0.09);
  return {
    primary,
    onPrimary: p("on-primary") ?? textOn(primary),
    good,
    bad,
    muted,
    ink: p("ink") ?? primary,
    surface,
    pill: p("pill") ?? mix(primary, surface, dark ? 0.22 : 0.12),
    highlight: p("highlight") ?? mix(good, "#FFFFFF", 0.3),
    background,
    foreground,
    accent,
    accentInk: p("accent-ink") ?? accent,
    rule: p("rule") ?? mix(foreground, background, dark ? 0.2 : 0.1),
    section,
    onSection: p("on-section") ?? textOn(section),
    titleSlide: p("title-slide"),
    tints: {
      good: tint("good", good),
      bad: tint("bad", bad),
      neutral: tint("neutral", primary),
      muted: tint("muted", muted),
    },
    fonts: b?.fonts ?? { base: null, headings: null },
  };
}

/** Default palette (no `_brand.yml`). */
export const DEFAULT_PALETTE: DeckPalette = brandPalette(null);

/** Folder of the main file within the deck dir ("" for the deck root). */
function mainDir(main: string): string {
  const i = main.lastIndexOf("/");
  return i < 0 ? "" : main.slice(0, i);
}

/** Path of the `_brand.yml` Quarto reads for this deck. */
export function brandPath(dir: string, main: string): string {
  const sub = mainDir(main);
  return `${dir.replace(/\/$/, "")}/${sub ? sub + "/" : ""}_brand.yml`;
}

/** The deck's brand, or null when it has no `_brand.yml`. */
export async function readBrand(
  dir: string,
  main: string,
): Promise<Brand | null> {
  try {
    return parseBrand(await Deno.readTextFile(brandPath(dir, main)));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw new Error(`${brandPath(dir, main)}: ${(e as Error).message}`);
  }
}

/** The deck's palette (neutral defaults without `_brand.yml`). */
export async function deckPalette(
  dir: string,
  main: string,
): Promise<DeckPalette> {
  return brandPalette(await readBrand(dir, main));
}
