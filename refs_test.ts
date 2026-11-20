import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { refreshRefs, replaceNumberedList, srcDetail } from "./refs.ts";

Deno.test("srcDetail keeps the figure part of an old source line", () => {
  assertEquals(srcDetail("Hirschey et al., Nature 2010, Fig. 3c"), ", Fig. 3c");
  assertEquals(
    srcDetail("Yuan et al. 2024, iScience 27:109991, Fig. 2A,B. Skin fibroblasts"),
    ", Fig. 2A,B. Skin fibroblasts",
  );
  assertEquals(srcDetail("Du et al., Science 2011. Table 1"), ", Table 1");
  assertEquals(srcDetail("Haigis et al., Cell 2006"), "");
});

Deno.test("refreshRefs rewrites .src and a wrapped Ref: line, keeps CHECK", () => {
  const lines = [
    "## T",
    "",
    "![](a.png)",
    "",
    "[Okafor et al., Molecular Cell 2017, Fig. 4H-K]{.src}",
    "",
    "::: notes",
    "~2'. Words.",
    "Ref: Okafor L, Lindqvist PJ, Santos MK, van Dam AM et al.",
    "  Mol Cell 68:412 (2017), doi:10.1234/molcel.2017.0412.",
    "CHECK: panel K?",
    ":::",
  ];
  const r = refreshRefs(
    lines,
    0,
    lines.length,
    "Okafor, Lindqvist, Santos, **van Dam** et al. 2017, Mol Cell 68:412",
    "Okafor L, **van Dam AM** (2017) T. Mol Cell 68:412–425",
    "10.1234/molcel.2017.0412",
  );
  assertEquals(
    r.lines[4],
    "[Okafor, Lindqvist, Santos, **van Dam** et al. 2017, Mol Cell 68:412, Fig. 4H-K]{.src}",
  );
  assertEquals(r.lines.slice(7, 11), [
    "~2'. Words.",
    "Ref: Okafor L, **van Dam AM** (2017) T. Mol Cell 68:412–425, doi:10.1234/molcel.2017.0412.",
    "CHECK: panel K?",
    ":::",
  ]);
  assertEquals(r.changes.length, 2);
});

Deno.test("replaceNumberedList swaps the list, keeps the rest", () => {
  const lines = ["## Learning outcomes", "", "1. Old one", "   wrapped", "2. Old two", "", "::: notes", ":::"];
  const out = replaceNumberedList(lines, 0, lines.length, ["**New** one", "New two", "New three"]);
  assertEquals(out.slice(2, 6), ["1. **New** one", "2. New two", "3. New three", ""]);
  assertThrows(() => replaceNumberedList(["## X", "text"], 0, 2, ["a"]));
});

Deno.test("refs_update and outcomes_set are methods, and every resource has a schema", async () => {
  const { model } = await import("./quarto_deck.ts");
  for (const m of ["refs_update", "outcomes_set", "slide_edit"]) {
    assertEquals(m in model.methods, true, m);
    assertEquals(m in model.resources, false, m);
  }
  for (const [name, r] of Object.entries(model.resources)) {
    assertEquals("schema" in (r as object), true, name);
  }
});
