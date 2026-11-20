import { assertEquals } from "jsr:@std/assert@1";
import { ZipArchive } from "./zip.ts";
import { imagePptx } from "./export_pptx.ts";
import { encodePng } from "./figures.ts";
import { inventory, layerCopy, loadPptx } from "./pptx.ts";

Deno.test("ZipArchive reads, replaces and writes entries in order", async () => {
  // an empty zip (end-of-central-directory record only)
  const empty = new Uint8Array(22);
  empty.set([0x50, 0x4b, 0x05, 0x06]);
  const z = await ZipArchive.loadAsync(empty);
  z.file("[Content_Types].xml", "<Types/>");
  z.file("ppt/a.xml", "<a>é</a>");
  const a = await ZipArchive.loadAsync(await z.generateAsync());
  assertEquals(a.paths, ["[Content_Types].xml", "ppt/a.xml"]);
  assertEquals(await a.file("ppt/a.xml")!.async("string"), "<a>é</a>");
  assertEquals(a.file("missing.xml"), null);
  a.file("ppt/a.xml", "<b/>");
  const b = await ZipArchive.loadAsync(await a.generateAsync());
  assertEquals(await b.file("ppt/a.xml")!.async("string"), "<b/>");
});

Deno.test("a real .pptx: inventory, then layerCopy hides the other slides", async () => {
  const png = await encodePng({
    width: 4,
    height: 3,
    data: new Uint8Array(4 * 3 * 3).fill(200),
  });
  const bytes = await imagePptx([
    { n: 1, title: "One", notes: "first", png },
    { n: 2, title: "Two", notes: "second", png },
  ]);
  const inv = await inventory(await loadPptx(bytes));
  assertEquals(inv.length, 2);
  assertEquals(inv.map((s) => s.notes.trim()), ["first", "second"]);
  const copy = await layerCopy(bytes, 2, {});
  const after = await inventory(await loadPptx(copy));
  assertEquals(after.map((s) => s.hidden), [true, false]);
});
