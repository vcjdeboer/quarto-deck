/**
 * Print a rendered reveal.js deck to PDF with headless Chrome (`?print-pdf`),
 * and shrink it for distribution with a macOS Quartz filter (JPEG-recompress
 * and downsample embedded images).
 * @module
 */
import { MAC_CHROME } from "./chrome.ts";

/** Quartz filter plist: JPEG quality 0–1, target dpi, max image side in px. */
export function quartzFilterPlist(
  opts: { quality: number; dpi: number; maxPx: number },
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Domains</key><dict><key>Applications</key><true/><key>Printing</key><true/></dict>
<key>FilterData</key><dict><key>ColorSettings</key><dict><key>ImageSettings</key><dict>
<key>Compression Quality</key><real>${opts.quality}</real>
<key>ImageCompression</key><string>ImageJPEGCompress</string>
<key>ImageScaleSettings</key><dict>
<key>ImageResolution</key><integer>${Math.round(opts.dpi)}</integer>
<key>ImageScaleInterpolate</key><true/>
<key>ImageSizeMax</key><integer>${Math.round(opts.maxPx)}</integer>
<key>ImageSizeMin</key><integer>0</integer>
</dict></dict></dict></dict>
<key>FilterType</key><integer>1</integer>
<key>Name</key><string>quarto-deck</string>
</dict></plist>
`;
}

const SHRINK_JXA = `ObjC.import('Quartz');
function run(argv) {
  var doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  var f = $.QuartzFilter.quartzFilterWithURL($.NSURL.fileURLWithPath(argv[2]));
  var opts = $.NSDictionary.dictionaryWithObjectForKey(f, 'QuartzFilter');
  return doc.writeToFileWithOptions(argv[1], opts);
}`;

async function run(cmd: string, args: string[], timeoutMs = 300000): Promise<
  { code: number; stdout: string; stderr: string }
> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const out = await new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "piped",
      signal: ac.signal,
    }).output();
    const dec = new TextDecoder();
    return {
      code: out.code,
      stdout: dec.decode(out.stdout),
      stderr: dec.decode(out.stderr),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Page count via poppler's `pdfinfo` (null when unavailable). */
export async function pdfPages(pdf: string): Promise<number | null> {
  try {
    const r = await run("pdfinfo", [pdf], 30000);
    const m = r.stdout.match(/^Pages:\s+(\d+)/m);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** Print `html` to `out` with Chrome's reveal.js print layout. */
export async function printDeck(opts: {
  html: string;
  out: string;
  chrome?: string;
  budgetMs?: number;
}): Promise<void> {
  const profile = await Deno.makeTempDir({ prefix: "quarto-deck-print-" });
  try {
    const r = await run(opts.chrome ?? MAC_CHROME, [
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
      `--virtual-time-budget=${opts.budgetMs ?? 15000}`,
      `--user-data-dir=${profile}`,
      `--print-to-pdf=${opts.out}`,
      `file://${opts.html}?print-pdf`,
    ]);
    const st = await Deno.stat(opts.out).catch(() => null);
    if (!st || st.size === 0) {
      throw new Error(
        `Chrome did not write ${opts.out}: ${r.stderr.slice(-400)}`,
      );
    }
  } finally {
    await Deno.remove(profile, { recursive: true }).catch(() => {});
  }
}

/** Shrink a PDF with a Quartz filter (macOS only). Returns the output size. */
export async function shrinkPdf(opts: {
  input: string;
  out: string;
  quality?: number;
  dpi?: number;
  maxPx?: number;
}): Promise<number> {
  if (Deno.build.os !== "darwin") {
    throw new Error(
      "shrink uses the macOS Quartz filter; not available on " + Deno.build.os,
    );
  }
  const dir = await Deno.makeTempDir({ prefix: "quarto-deck-shrink-" });
  try {
    const filter = `${dir}/deck.qfilter`;
    const script = `${dir}/shrink.js`;
    await Deno.writeTextFile(
      filter,
      quartzFilterPlist({
        quality: opts.quality ?? 0.75,
        dpi: opts.dpi ?? 150,
        maxPx: opts.maxPx ?? 1600,
      }),
    );
    await Deno.writeTextFile(script, SHRINK_JXA);
    const r = await run("osascript", [
      "-l",
      "JavaScript",
      script,
      opts.input,
      opts.out,
      filter,
    ]);
    if (r.code !== 0 || !r.stdout.includes("true")) {
      throw new Error(`Quartz shrink failed: ${r.stderr || r.stdout}`);
    }
    return (await Deno.stat(opts.out)).size;
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}
