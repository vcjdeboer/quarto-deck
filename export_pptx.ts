/**
 * Write a .pptx with one full-bleed image per slide and the speaker notes
 * attached: the deck looks exactly as rendered, for organisers who need
 * PowerPoint. Not editable slide by slide — that is the trade-off.
 * @module
 */
import pptxgen from "npm:pptxgenjs@3.12.0";
import type { CapturedSlide } from "./check.ts";

/** The part of the pptxgenjs API used here (its CJS typings are not constructable under Deno). */
interface Pptx {
  layout: string;
  title: string;
  author: string;
  addSlide(): {
    addImage(o: Record<string, unknown>): unknown;
    addNotes(text: string): unknown;
  };
  write(o: { outputType: "uint8array" }): Promise<unknown>;
}
const PptxGen = pptxgen as unknown as new () => Pptx;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Build the pptx bytes (16:9, 13.333 × 7.5 in). */
export async function imagePptx(
  slides: CapturedSlide[],
  meta: { title?: string; author?: string } = {},
): Promise<Uint8Array> {
  const p = new PptxGen();
  p.layout = "LAYOUT_WIDE";
  if (meta.title) p.title = meta.title;
  if (meta.author) p.author = meta.author;
  for (const s of slides) {
    const slide = p.addSlide();
    slide.addImage({
      data: `image/png;base64,${toBase64(s.png)}`,
      x: 0,
      y: 0,
      w: 13.333,
      h: 7.5,
      altText: s.title,
    });
    if (s.notes) slide.addNotes(s.notes);
  }
  return await p.write({ outputType: "uint8array" }) as Uint8Array;
}
