/**
 * Render a Quarto deck (R/knitr and other engines execute) and record what
 * went in: a content hash over the included .qmd files and every referenced
 * image, plus the Quarto and R versions.
 * @module
 */
import type { DeckOutline } from "./outline.ts";

/** Record of one render. */
export interface BuildRecord {
  main: string;
  html: string;
  inputHash: string;
  inputs: number;
  seconds: number;
  quartoVersion: string | null;
  rVersion: string | null;
  warnings: string[];
  renderedAt: string;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Files that determine the render: the include tree, referenced images, and
 * the theme / header / script files named in the main YAML.
 */
export function renderInputs(dir: string, outline: DeckOutline): string[] {
  const set = new Set<string>(outline.files);
  for (const s of outline.slides) for (const p of s.images) set.add(p);
  try {
    const head =
      Deno.readTextFileSync(`${dir}/${outline.main}`).split(/\n---\s*\n/)[0];
    for (
      const m of head.matchAll(
        /([\w./-]+\.(?:scss|css|html|js|lua|bib|csl|R|r|py))/g,
      )
    ) {
      set.add(m[1]);
    }
  } catch { /* main unreadable: outline would have failed already */ }
  return [...set].sort();
}

/** One hash over (path, content) of every existing input file. */
export async function hashInputs(
  dir: string,
  files: string[],
): Promise<string> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const f of files) {
    try {
      const bytes = await Deno.readFile(`${dir}/${f}`);
      parts.push(enc.encode(`${f}\n${await sha256Hex(bytes)}\n`));
    } catch { /* missing inputs are reported by outline */ }
  }
  const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return await sha256Hex(all);
}

/** Warnings worth surfacing from a Quarto log. */
export function warningsFromLog(log: string): string[] {
  return log.split(/\r?\n/)
    .filter((l) => /\b(WARN|WARNING|Warning)\b/.test(l))
    .map((l) => l.trim());
}

async function firstLine(cmd: string, args: string[]): Promise<string | null> {
  try {
    // swamp-quality-ignore deno-command: reads quarto --version and R --version; argv array, no shell
    const o = await new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const txt = new TextDecoder().decode(o.stdout).trim() ||
      new TextDecoder().decode(o.stderr).trim();
    return txt.split("\n")[0] || null;
  } catch {
    return null;
  }
}

/** Run `quarto render` on the main file; throws with the log tail on failure. */
export async function renderDeck(opts: {
  dir: string;
  main: string;
  quarto?: string;
  extraArgs?: string[];
  timeoutMs?: number;
}): Promise<{ log: string; seconds: number; warnings: string[] }> {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 900000);
  try {
    // swamp-quality-ignore deno-command: quarto render is the point of the method; argv array, cwd = deck dir, no shell
    const out = await new Deno.Command(opts.quarto ?? "quarto", {
      args: ["render", opts.main, ...(opts.extraArgs ?? [])],
      cwd: opts.dir,
      stdout: "piped",
      stderr: "piped",
      signal: ac.signal,
    }).output();
    const dec = new TextDecoder();
    const log = dec.decode(out.stdout) + dec.decode(out.stderr);
    if (out.code !== 0) {
      throw new Error(
        `quarto render failed (exit ${out.code}):\n${log.slice(-2000)}`,
      );
    }
    return {
      log,
      seconds: (Date.now() - t0) / 1000,
      warnings: warningsFromLog(log),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Quarto and R versions on this machine. */
export async function toolVersions(quarto = "quarto"): Promise<
  { quartoVersion: string | null; rVersion: string | null }
> {
  const [quartoVersion, rVersion] = await Promise.all([
    firstLine(quarto, ["--version"]),
    firstLine("R", ["--version"]),
  ]);
  return { quartoVersion, rVersion };
}
