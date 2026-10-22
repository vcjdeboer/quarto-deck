/**
 * Walk a rendered reveal.js deck in headless Chrome: per slide the title,
 * reveal indices and overflow beyond the slide box (all fragments shown), a
 * screenshot, and contact sheets built from those screenshots.
 * @module
 */
import { type ChromePage, launchChrome, waitForReveal } from "./chrome.ts";

/** What the browser saw on one slide. */
export interface SlideCheck {
  n: number;
  h: number;
  v: number;
  title: string;
  fragments: number;
  overflowPx: number;
  overflowElement: string;
}

/** Result of checking a whole deck. */
export interface DeckCheck {
  html: string;
  slideCount: number;
  overflowing: SlideCheck[];
  slides: SlideCheck[];
  width: number;
  height: number;
}

/** Slides that overflow by more than `tolerancePx`. */
export function overflowing(
  slides: SlideCheck[],
  tolerancePx = 2,
): SlideCheck[] {
  return slides.filter((s) => s.overflowPx > tolerancePx);
}

/** Group slide numbers into contact-sheet pages. */
export function sheetPages(n: number, perSheet: number): number[][] {
  const pages: number[][] = [];
  for (let i = 1; i <= n; i += perSheet) {
    pages.push(
      Array.from({ length: Math.min(perSheet, n - i + 1) }, (_, k) => i + k),
    );
  }
  return pages;
}

const MEASURE = (w: number, h: number) =>
  `(async () => {
  const slide = Reveal.getCurrentSlide();
  const box = slide.getBoundingClientRect();
  const scale = Reveal.getScale();
  let worst = 0, who = '';
  slide.querySelectorAll('img, svg, video, canvas, p, li, table, .columns, .r-stack, h1, h2, h3, pre')
    .forEach((el) => {
      if (el.closest('aside.notes')) return;
      const r = el.getBoundingClientRect();
      if (!r.height || !r.width) return;
      const over = Math.max(
        (r.bottom - (box.top + ${h} * scale)) / scale,
        (r.right - (box.left + ${w} * scale)) / scale,
      );
      if (over > worst) {
        worst = over;
        const cls = typeof el.className === 'string' ? el.className : (el.className.baseVal || '');
        who = el.tagName.toLowerCase() + (cls ? '.' + cls.trim().split(/\\s+/).join('.') : '') +
          (el.getAttribute('src') ? ' ' + el.getAttribute('src').split('/').pop() : '');
      }
    });
  return { overflowPx: Math.round(worst), overflowElement: who };
})()`;

/** Navigate to slide `i` (0-based in Reveal.getSlides()) with all fragments shown. */
async function showSlide(page: ChromePage, i: number): Promise<{
  h: number;
  v: number;
  title: string;
  fragments: number;
}> {
  return await page.evaluate(`(async () => {
    const s = Reveal.getSlides()[${i}];
    const idx = Reveal.getIndices(s);
    Reveal.slide(idx.h, idx.v, 999);
    s.querySelectorAll('img[data-src]').forEach((im) => { im.src = im.dataset.src; });
    await Promise.all([...s.querySelectorAll('img')].map((im) =>
      im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 3000); })));
    await new Promise((r) => setTimeout(r, 400));
    const t = s.querySelector('h1, h2');
    const title = ((t && t.textContent.trim()) ? t.textContent : s.textContent).replace(/\\s+/g, ' ').trim().slice(0, 80);
    return { h: idx.h, v: idx.v || 0, title, fragments: s.querySelectorAll('.fragment').length };
  })()`);
}

/**
 * Check a rendered deck. Screenshots (JPEG) are returned in order; pass
 * `screenshots: false` to only measure.
 */
export async function checkDeck(opts: {
  html: string;
  chrome?: string;
  width?: number;
  height?: number;
  screenshots?: boolean;
}): Promise<{ check: DeckCheck; shots: Uint8Array[] }> {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const page = await launchChrome(opts.chrome, { width, height });
  try {
    await page.goto("file://" + opts.html);
    await waitForReveal(page);
    await page.evaluate(
      "Reveal.configure({ transition: 'none', backgroundTransition: 'none', controls: false, progress: false })",
    );
    const n = await page.evaluate<number>("Reveal.getSlides().length");
    const slides: SlideCheck[] = [];
    const shots: Uint8Array[] = [];
    for (let i = 0; i < n; i++) {
      const info = await showSlide(page, i);
      const m = await page.evaluate<
        { overflowPx: number; overflowElement: string }
      >(
        MEASURE(width, height),
      );
      slides.push({ n: i + 1, ...info, ...m });
      if (opts.screenshots !== false) {
        shots.push(await page.screenshot("jpeg", 70));
      }
    }
    return {
      check: {
        html: opts.html,
        slideCount: n,
        overflowing: overflowing(slides),
        slides,
        width,
        height,
      },
      shots,
    };
  } finally {
    await page.close();
  }
}

/** Build contact sheets (PNG) from slide screenshots, `cols`×`rows` per sheet. */
export async function contactSheets(
  shots: Uint8Array[],
  titles: string[],
  opts: { chrome?: string; cols?: number; rows?: number } = {},
): Promise<Uint8Array[]> {
  const cols = opts.cols ?? 3;
  const rows = opts.rows ?? 4;
  const tw = 420, th = 236, pad = 8, label = 22;
  const sheetW = cols * (tw + pad) + pad;
  const sheetH = rows * (th + label + pad) + pad;
  const dir = await Deno.makeTempDir({ prefix: "quarto-deck-sheet-" });
  const page = await launchChrome(opts.chrome, {
    width: sheetW,
    height: sheetH,
  });
  const out: Uint8Array[] = [];
  try {
    for (let i = 0; i < shots.length; i++) {
      await Deno.writeFile(`${dir}/s${i + 1}.jpg`, shots[i]);
    }
    const esc = (s: string) =>
      s.replace(/[<&>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    for (const [k, nums] of sheetPages(shots.length, cols * rows).entries()) {
      const cells = nums.map((n) =>
        `<figure><img src="s${n}.jpg"><figcaption>${n}. ${
          esc(titles[n - 1] ?? "")
        }</figcaption></figure>`
      ).join("");
      const html = `<!doctype html><meta charset="utf-8"><style>
        body{margin:0;background:#777;font:13px -apple-system,Helvetica,sans-serif}
        main{display:grid;grid-template-columns:repeat(${cols},${tw}px);gap:${pad}px;padding:${pad}px}
        figure{margin:0;background:#fff}
        img{width:${tw}px;height:${th}px;display:block;object-fit:contain;background:#fff}
        figcaption{height:${label}px;line-height:${label}px;padding:0 6px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;background:#222;color:#eee}
        </style><main>${cells}</main>`;
      await Deno.writeTextFile(`${dir}/sheet${k}.html`, html);
      await page.goto(`file://${dir}/sheet${k}.html`);
      await new Promise((r) => setTimeout(r, 300));
      out.push(await page.screenshot("png"));
    }
    return out;
  } finally {
    await page.close();
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

/** One slide captured for export: image plus speaker notes. */
export interface CapturedSlide {
  n: number;
  title: string;
  notes: string;
  png: Uint8Array;
}

/** Screenshot every slide (all fragments shown) with its speaker notes. */
export async function captureSlides(opts: {
  html: string;
  chrome?: string;
  width?: number;
  height?: number;
  scale?: number;
}): Promise<CapturedSlide[]> {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const page = await launchChrome(
    opts.chrome,
    { width, height },
    opts.scale ?? 1.5,
  );
  try {
    await page.goto("file://" + opts.html);
    await waitForReveal(page);
    await page.evaluate(
      "Reveal.configure({ transition: 'none', backgroundTransition: 'none', controls: false, progress: false, slideNumber: false })",
    );
    const n = await page.evaluate<number>("Reveal.getSlides().length");
    const out: CapturedSlide[] = [];
    for (let i = 0; i < n; i++) {
      const info = await showSlide(page, i);
      const notes = await page.evaluate<string>(
        `(Reveal.getSlides()[${i}].querySelector('aside.notes')?.innerText || '').trim()`,
      );
      out.push({
        n: i + 1,
        title: info.title,
        notes,
        png: await page.screenshot("png"),
      });
    }
    return out;
  } finally {
    await page.close();
  }
}
