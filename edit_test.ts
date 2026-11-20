import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  appendEntry,
  blockLabels,
  counterNumbers,
  counterUnsafe,
  hashedName,
  holdEntry,
  editSlideLines,
  imageRefs,
  insertLines,
  longDate,
  moveLines,
  orderDiff,
  parseAddress,
  removeLines,
  replaceRef,
  resolveSlide,
  slideLabel,
  slideSpan,
  spanText,
} from "./edit.ts";
import { parseQmd, type SourceLine } from "./outline.ts";
import { model } from "./quarto_deck.ts";

const src = (text: string, file = "a.qmd"): SourceLine[] =>
  text.split("\n").map((t, i) => ({ file, line: i + 1, text: t }));
const slidesOf = (text: string, file = "a.qmd") =>
  parseQmd(src(text, file)).slides;

const DECK = [
  "## Alpha",
  "",
  "![](assets/a.png){.r-stretch}",
  "",
  "::: notes",
  "~1'. Alpha notes",
  "## not a heading inside notes",
  ":::",
  "",
  "## {.statement .center .sm}",
  "",
  "Why would a **repair enzyme** control blood sugar?",
  "",
  "::: notes",
  "~1'. Ask.",
  ":::",
  "",
  '## Beta {visibility="hidden"}',
  "",
  "beta body",
  "",
  "## Gamma",
  "",
  "gamma body",
  "",
].join("\n");

Deno.test("parseAddress: number, numeric string, file:line, title", () => {
  assertEquals(parseAddress(12), { kind: "n", n: 12 });
  assertEquals(parseAddress(" 7 "), { kind: "n", n: 7 });
  assertEquals(parseAddress("glyc/_04_lactate.qmd:91"), {
    kind: "loc",
    file: "glyc/_04_lactate.qmd",
    line: 91,
  });
  assertEquals(parseAddress("Block PFK1"), {
    kind: "title",
    text: "Block PFK1",
  });
  assertThrows(() => parseAddress("  "), Error, "empty");
});

Deno.test("slideLabel uses the shown text of an untitled slide", () => {
  const s = slidesOf(DECK);
  assertEquals(slideLabel(s[0]), "Alpha");
  assertEquals(
    slideLabel(s[1]),
    "Why would a repair enzyme control blood sugar?",
  );
});

Deno.test("counterNumbers: title slide is 1, hidden and uncounted get none", () => {
  const s = slidesOf(DECK);
  assertEquals(counterNumbers(s, { titleSlide: true }).numbers, [
    2,
    3,
    null,
    4,
  ]);
  assertEquals(counterNumbers(s, { titleSlide: false }).numbers, [
    1,
    2,
    null,
    3,
  ]);
  const r = counterNumbers(s, {
    titleSlide: true,
    uncounted: [false, true, false, false],
  });
  assertEquals(r.numbers, [2, null, null, 3]);
  assertEquals(r.total, 3);
});

Deno.test("counterUnsafe flags vertical navigation, slide-level and --- breaks", () => {
  const s = slidesOf(DECK);
  assertEquals(counterUnsafe("title: x\nformat: revealjs", s), null);
  assertStringIncludes(
    counterUnsafe("navigation-mode: vertical", s)!,
    "vertical",
  );
  assertStringIncludes(counterUnsafe("slide-level: 3", s)!, "slide-level");
  assertEquals(counterUnsafe("slide-level: 2", s), null);
  const hr = slidesOf("## A\n\nx\n\n---\n\ny\n");
  assertStringIncludes(counterUnsafe("", hr)!, "---");
});

Deno.test("resolveSlide by title: substring, case, untitled body text, exact wins", () => {
  const s = slidesOf(DECK);
  const c = { titleSlide: true };
  assertEquals(resolveSlide(s, parseAddress("gamma"), c), 3);
  assertEquals(resolveSlide(s, parseAddress("REPAIR ENZYME"), c), 1);
  assertEquals(resolveSlide(s, parseAddress("beta"), c), 2); // hidden still addressable
  const twins = slidesOf(
    "## PFK1\n\n## PFK1 knockout mice\n\n## PFK1 and ATP\n",
  );
  assertEquals(resolveSlide(twins, parseAddress("pfk1"), c), 0);
  assertEquals(resolveSlide(twins, parseAddress("  pfk1  "), c), 0);
  assertEquals(resolveSlide(twins, parseAddress("PFK1 k"), c), 1);
  assertEquals(resolveSlide(twins, parseAddress("and"), c), 2);
  const none = assertThrows(() =>
    resolveSlide(twins, parseAddress("PFK2"), c)
  ) as Error;
  assertStringIncludes(none.message, "no slide matches");
  const amb2 = assertThrows(
    () =>
      resolveSlide(
        slidesOf("## PFK1 a\n\n## PFK1 b\n"),
        parseAddress("pfk1"),
        c,
      ),
  ) as Error;
  assertStringIncludes(amb2.message, "matches 2 slides");
  assertStringIncludes(amb2.message, "a.qmd:1");
  assertStringIncludes(amb2.message, "a.qmd:3");
});

Deno.test("resolveSlide by number and by file:line", () => {
  const s = slidesOf(DECK);
  const c = { titleSlide: true };
  assertEquals(resolveSlide(s, parseAddress(2), c), 0);
  assertEquals(resolveSlide(s, parseAddress(4), c), 3);
  assertStringIncludes(
    (assertThrows(() => resolveSlide(s, parseAddress(1), c)) as Error).message,
    "title slide",
  );
  assertStringIncludes(
    (assertThrows(() => resolveSlide(s, parseAddress(9), c)) as Error).message,
    "no slide 9",
  );
  assertStringIncludes(
    (assertThrows(() =>
      resolveSlide(s, parseAddress(2), { titleSlide: true, unsafe: "vertical" })
    ) as Error)
      .message,
    "by title",
  );
  assertEquals(resolveSlide(s, parseAddress("a.qmd:22"), c), 3);
  assertStringIncludes(
    (assertThrows(() => resolveSlide(s, parseAddress("a.qmd:5"), c)) as Error)
      .message,
    "slides in that file",
  );
});

Deno.test("slideSpan runs to the next heading, an include, or the end", () => {
  const lines = DECK.split("\n");
  assertEquals(slideSpan(lines, 1, 10), { start: 0, end: 9 });
  assertEquals(slideSpan(lines, 22, null), { start: 21, end: lines.length });
  const main = [
    "## Intro",
    "",
    "x",
    "",
    "{{< include a/_b.qmd >}}",
    "",
    "## Next",
  ];
  assertEquals(slideSpan(main, 1, 7), { start: 0, end: 4 });
  assertEquals(
    spanText(lines, slideSpan(lines, 1, 10)).split("\n")[0],
    "## Alpha",
  );
  assert(spanText(lines, slideSpan(lines, 1, 10)).endsWith(":::\n"));
});

Deno.test("insertLines: blank line on each side, trailing newline kept", () => {
  const lines = "## A\n\na\n\n## B\n\nb\n".split("\n");
  const mid = insertLines(lines, 4, "\n\n## X\n\nx\n\n");
  assertEquals(mid.lines.join("\n"), "## A\n\na\n\n## X\n\nx\n\n## B\n\nb\n");
  assertEquals(mid.line, 5);
  const end = insertLines(lines, lines.length, "## X\nx");
  assertEquals(end.lines.join("\n"), "## A\n\na\n\n## B\n\nb\n\n## X\nx\n");
  assertEquals(end.line, 9);
  const top = insertLines(lines, 0, "## X");
  assertEquals(top.lines.join("\n"), "## X\n\n## A\n\na\n\n## B\n\nb\n");
  assertEquals(top.line, 1);
  // no trailing newline, no blank before the next heading
  const tight = insertLines("## A\na".split("\n"), 2, "## X");
  assertEquals(tight.lines.join("\n"), "## A\na\n\n## X\n");
  const beforeInclude = insertLines(
    ["## A", "a", "{{< include b.qmd >}}"],
    2,
    "## X",
  );
  assertEquals(beforeInclude.lines, [
    "## A",
    "a",
    "",
    "## X",
    "",
    "{{< include b.qmd >}}",
  ]);
  assertThrows(() => insertLines(lines, 0, "\n\n"), Error, "empty");
});

Deno.test("removeLines takes the slide with its notes and trailing blanks", () => {
  const lines = DECK.split("\n");
  const r = removeLines(lines, slideSpan(lines, 1, 10));
  assertEquals(r.lines[0], "## {.statement .center .sm}");
  assertStringIncludes(r.block, "## not a heading inside notes");
  assertStringIncludes(r.block, "~1'. Alpha notes");
  const last = removeLines(lines, slideSpan(lines, 22, null));
  assert(last.lines.join("\n").endsWith("beta body\n"));
  assertEquals(last.block, "## Gamma\n\ngamma body\n");
});

Deno.test("moveLines within a file, both directions, and across files", () => {
  const a = "## A\n\na\n\n## B\n\nb\n\n## C\n\nc\n".split("\n");
  // A after C
  const down = moveLines({ f: a }, { file: "f", span: slideSpan(a, 1, 5) }, {
    file: "f",
    at: a.length,
  });
  assertEquals(
    down.files.f.join("\n"),
    "## B\n\nb\n\n## C\n\nc\n\n## A\n\na\n",
  );
  assertEquals(down.line, 9);
  // C before A
  const up = moveLines({ f: a }, { file: "f", span: slideSpan(a, 9, null) }, {
    file: "f",
    at: 0,
  });
  assertEquals(up.files.f.join("\n"), "## C\n\nc\n\n## A\n\na\n\n## B\n\nb\n");
  assertEquals(up.line, 1);
  // A after B: target index is B's end (8), after the removed span
  const swap = moveLines({ f: a }, { file: "f", span: slideSpan(a, 1, 5) }, {
    file: "f",
    at: 8,
  });
  assertEquals(
    swap.files.f.join("\n"),
    "## B\n\nb\n\n## A\n\na\n\n## C\n\nc\n",
  );
  assertEquals(swap.line, 5);
  // across files: B into g, before Y
  const g = "## X\n\nx\n\n## Y\n\ny\n".split("\n");
  const cross = moveLines(
    { f: a, g },
    { file: "f", span: slideSpan(a, 5, 9) },
    { file: "g", at: 4 },
  );
  assertEquals(cross.files.f.join("\n"), "## A\n\na\n\n## C\n\nc\n");
  assertEquals(
    cross.files.g.join("\n"),
    "## X\n\nx\n\n## B\n\nb\n\n## Y\n\ny\n",
  );
  assertEquals(cross.line, 5);
  assertEquals(a.join("\n"), "## A\n\na\n\n## B\n\nb\n\n## C\n\nc\n"); // inputs untouched
  assertThrows(
    () =>
      moveLines({ f: a }, { file: "f", span: slideSpan(a, 1, 5) }, {
        file: "f",
        at: 2,
      }),
    Error,
    "inside itself",
  );
});

Deno.test("imageRefs: reading order, heading background, notes and fences skipped", () => {
  const lines = [
    '## {.bleed background-image="assets/bg.png"}',
    "",
    '<img src="assets/b.png"> and ![](assets/a.png){.r-stretch}',
    "![](https://x.org/y.png)",
    "```",
    "![](assets/in_code.png)",
    "```",
    ":::: {.columns}",
    "![](assets/c.jpg)",
    "::::",
    "::: notes",
    "![](assets/in_notes.png)",
    ":::",
    "![](assets/d.png)",
  ];
  const refs = imageRefs(lines, { start: 0, end: lines.length });
  assertEquals(refs.map((r) => r.path), [
    "assets/bg.png",
    "assets/b.png",
    "assets/a.png",
    "assets/c.jpg",
    "assets/d.png",
  ]);
  const out = replaceRef(lines, refs[2], "assets/a_0123abcd.png");
  assertEquals(
    out[2],
    '<img src="assets/b.png"> and ![](assets/a_0123abcd.png){.r-stretch}',
  );
  assertEquals(
    lines[2],
    '<img src="assets/b.png"> and ![](assets/a.png){.r-stretch}',
  );
  const bg = replaceRef(lines, refs[0], "assets/bg_00000000.png");
  assertEquals(bg[0], '## {.bleed background-image="assets/bg_00000000.png"}');
  assertThrows(() => replaceRef(["x"], refs[0], "y"), Error, "moved");
});

Deno.test("hashedName keeps folder and stem, swaps an old hash, takes the new extension", () => {
  const h = "0123abcdffffffff";
  assertEquals(
    hashedName("assets/moreau/fig1c.png", "/tmp/new.png", h),
    "assets/moreau/fig1c_0123abcd.png",
  );
  assertEquals(
    hashedName("assets/moreau/fig1c_deadbeef.png", "x.PNG", h),
    "assets/moreau/fig1c_0123abcd.png",
  );
  assertEquals(
    hashedName("assets/moreau/fig1c.png", "/tmp/new.jpg", h),
    "assets/moreau/fig1c_0123abcd.jpg",
  );
  assertEquals(hashedName("fig.png", "noext", h), "fig_0123abcd.png");
});

Deno.test("holdEntry: qmd gets a PARKED comment, md gets a fenced block", () => {
  const meta = {
    date: new Date(2026, 10, 19),
    file: "glyc/_05.qmd",
    line: 419,
    n: 63,
    label: "Two views on lactate and fatigue",
    after: "Where the lactate claim goes wrong",
    reason: "off-message",
  };
  assertEquals(longDate(meta.date), "19 November 2026");
  const q = holdEntry("qmd", "## T\n\nbody\n", meta);
  assertEquals(
    q,
    '<!--\nPARKED, 19 November 2026, from glyc/_05.qmd line 419 (slide 63), after "Where the lactate claim goes wrong". off-message.\n-->\n\n## T\n\nbody\n',
  );
  const m = holdEntry("md", "## T\n\n```r\nx\n```\n", {
    ...meta,
    after: null,
    reason: undefined,
  });
  assertStringIncludes(m, "## Parked 19 November 2026: Two views on lactate");
  assertStringIncludes(m, "first slide of the file");
  assertStringIncludes(m, "````markdown\n## T");
  assert(m.endsWith("````\n"));
  assertEquals(appendEntry("", "E\n"), "E\n");
  assertEquals(appendEntry("old\n\n\n", "E\n"), "old\n\nE\n");
});

Deno.test("blockLabels and orderDiff", () => {
  assertEquals(
    blockLabels(
      "\n## One\n\n::: notes\n## no\n:::\n\n## {.statement}\n\nTwo words.\n",
    ),
    [
      "One",
      "Two words.",
    ],
  );
  assertEquals(orderDiff(["a", "b"], ["a", "b"]), null);
  assertStringIncludes(orderDiff(["a", "b"], ["b", "a"])!, "position 1");
  assertStringIncludes(orderDiff(["a"], ["a", "b"])!, "(end)");
});

// ------------------------------------------------------------ methods on disk

function fakeCtx(dir: string, main = "talk.qmd") {
  const store = new Map<string, Record<string, unknown>>();
  const logs: string[] = [];
  return {
    store,
    logs,
    ctx: {
      globalArgs: {
        dir,
        main,
        slotMinutes: 5,
        chrome: "chrome",
        quarto: "quarto",
        sourcesDir: "sources",
        assetsDir: "assets",
      },
      logger: { info: (m: string) => logs.push(m) },
      writeResource: (
        _s: string,
        name: string,
        data: Record<string, unknown>,
      ) => {
        store.set(name, structuredClone(data));
        return Promise.resolve({ name });
      },
      readResource: (name: string) => Promise.resolve(store.get(name) ?? null),
      createFileWriter: () => {
        throw new Error("not used");
      },
    },
  };
}

// deno-lint-ignore no-explicit-any
const run = (m: string, args: unknown, ctx: unknown) =>
  (model.methods as any)[m].execute(args, ctx);

const MAIN =
  '---\ntitle: "T"\n---\n\n## Intro\n\n::: notes\n~1\'. i\n:::\n\n{{< include s/_a.qmd >}}\n\n{{< include s/_b.qmd >}}\n';
const PART_A =
  "## A one\n\n![](assets/one.png)\n\n::: notes\n~1'. a1\n:::\n\n## {.statement}\n\nA plain sentence.\n\n## A three\n\nx\n";
const PART_B = "## B one\n\nb\n\n## B two\n\nb2\n";

async function tempDeck(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "qd-edit-" });
  await Deno.mkdir(`${dir}/s`);
  await Deno.mkdir(`${dir}/assets`);
  await Deno.writeTextFile(`${dir}/talk.qmd`, MAIN);
  await Deno.writeTextFile(`${dir}/s/_a.qmd`, PART_A);
  await Deno.writeTextFile(`${dir}/s/_b.qmd`, PART_B);
  await Deno.writeFile(`${dir}/assets/one.png`, new Uint8Array([1, 2, 3]));
  return dir;
}

const titles = async (_dir: string, ctx: unknown) => {
  await run("outline", {}, ctx);
  return (await (ctx as {
    readResource: (n: string) => Promise<{ slides: Array<{ title: string }> }>;
  })
    .readResource("outline")).slides.map((s) => s.title);
};

Deno.test("slide_insert, slide_move, slide_delete, replace_image, restore on a deck", async () => {
  const dir = await tempDeck();
  const f = fakeCtx(dir);
  await Deno.writeTextFile(
    `${dir}/new.qmd`,
    "## Inserted\n\n::: notes\n~1'. n\n:::\n",
  );

  await run(
    "slide_insert",
    { after: "A plain sentence", file: "new.qmd" },
    f.ctx,
  );
  let e = f.store.get("edit")!;
  assertEquals([e.file, e.line, e.n], ["s/_a.qmd", 13, 5]);
  assertEquals(await titles(dir, f.ctx), [
    "Intro",
    "A one",
    "",
    "Inserted",
    "A three",
    "B one",
    "B two",
  ]);
  const firstBackup = e.backup as string;

  // across files, by number: "B two" is slide 8 (title slide = 1)
  await run("slide_move", { slide: 8, after: "Intro" }, f.ctx);
  e = f.store.get("edit")!;
  assertEquals([e.file, e.line, e.n], ["talk.qmd", 11, 3]);
  assertEquals(await titles(dir, f.ctx), [
    "Intro",
    "B two",
    "A one",
    "",
    "Inserted",
    "A three",
    "B one",
  ]);
  assertEquals(await Deno.readTextFile(`${dir}/s/_b.qmd`), "## B one\n\nb\n");
  assertStringIncludes(
    await Deno.readTextFile(`${dir}/talk.qmd`),
    "## B two\n\nb2\n\n{{< include s/_a.qmd >}}",
  );

  await run("slide_delete", { slide: "a three", reason: "too long" }, f.ctx);
  e = f.store.get("edit")!;
  assertEquals(e.file, "HOLD_talk.md");
  const hold = await Deno.readTextFile(`${dir}/HOLD_talk.md`);
  assertStringIncludes(
    hold,
    'From s/_a.qmd line 19 (slide 7), after "Inserted". too long.',
  );
  assertStringIncludes(hold, "````markdown\n## A three\n\nx\n````");
  assertEquals(await titles(dir, f.ctx), [
    "Intro",
    "B two",
    "A one",
    "",
    "Inserted",
    "B one",
  ]);

  await Deno.writeFile(`${dir}/replacement.png`, new Uint8Array([9, 9]));
  await run(
    "slide_replace_image",
    { slide: "A one", image: "replacement.png" },
    f.ctx,
  );
  e = f.store.get("edit")!;
  const a = await Deno.readTextFile(`${dir}/s/_a.qmd`);
  const m = a.match(/!\[\]\((assets\/one_[0-9a-f]{8}\.png)\)/);
  assert(m, a);
  assertEquals(await Deno.readFile(`${dir}/${m[1]}`), new Uint8Array([9, 9]));
  assertEquals(
    await Deno.readFile(`${dir}/assets/one.png`),
    new Uint8Array([1, 2, 3]),
  );

  // ambiguous address errors and lists candidates; nothing written
  await assertRejects(
    () => run("slide_delete", { slide: "one" }, f.ctx),
    Error,
    "matches 2 slides",
  );

  const entries = f.store.get("journal")!.entries as Array<
    { kind: string; text: string }
  >;
  assertEquals(entries.length, 4);
  assert(entries.every((x) => x.kind === "change"));

  await run("backup_list", {}, f.ctx);
  const list = f.store.get("backups")!.backups as Array<{ id: string }>;
  assertEquals(list.length, 4);
  assertEquals(list[0].id, firstBackup);

  // restore the first snapshot: s/_a.qmd is back as it was
  await run("restore", { id: firstBackup }, f.ctx);
  assertEquals(await Deno.readTextFile(`${dir}/s/_a.qmd`), PART_A);
  await run("backup_list", {}, f.ctx);
  assertEquals((f.store.get("backups")!.backups as unknown[]).length, 5);

  // restoring the move snapshot brings talk.qmd and _b.qmd back too
  await run("restore", { id: list[1].id }, f.ctx);
  assertEquals(await Deno.readTextFile(`${dir}/talk.qmd`), MAIN);
  assertEquals(await Deno.readTextFile(`${dir}/s/_b.qmd`), PART_B);
  // restoring the delete snapshot removes the HOLD file it created
  await run("restore", { id: list[2].id }, f.ctx);
  assertEquals(
    await Deno.stat(`${dir}/HOLD_talk.md`).then(() => true, () => false),
    false,
  );
  await Deno.remove(dir, { recursive: true });
});

Deno.test("slide_delete parks in a _hold*.qmd next to the deck files when there is one", async () => {
  const dir = await tempDeck();
  await Deno.writeTextFile(
    `${dir}/s/_hold_extra.qmd`,
    "<!-- parked slides -->\n",
  );
  const f = fakeCtx(dir);
  await run("slide_delete", { slide: "B one" }, f.ctx);
  const hold = await Deno.readTextFile(`${dir}/s/_hold_extra.qmd`);
  assertStringIncludes(hold, "<!-- parked slides -->\n\n<!--\nPARKED, ");
  assertStringIncludes(
    hold,
    'from s/_b.qmd line 1 (slide 6), after "A three".\n-->\n\n## B one\n\nb\n',
  );
  assertEquals(f.store.get("edit")!.line, 3);
  await run("slide_delete", { slide: "B two", park: false }, f.ctx);
  assertEquals(await Deno.readTextFile(`${dir}/s/_b.qmd`), "");
  assert(
    !(await Deno.readTextFile(`${dir}/s/_hold_extra.qmd`)).includes("B two"),
  );
  await Deno.remove(dir, { recursive: true });
});

Deno.test("slide numbers are refused when the last check disagrees with the source", async () => {
  const dir = await tempDeck();
  const f = fakeCtx(dir);
  f.store.set("check", { slideCount: 99 });
  await assertRejects(
    () => run("slide_delete", { slide: 3 }, f.ctx),
    Error,
    "last check saw 99",
  );
  f.store.set("check", { slideCount: 7 });
  await run("slide_delete", { slide: 3, park: false }, f.ctx);
  assertEquals(f.store.get("edit")!.slide, "A one");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("slide_insert rejects text without a heading and needs one of after/before", async () => {
  const dir = await tempDeck();
  const f = fakeCtx(dir);
  await assertRejects(
    () => run("slide_insert", { after: "Intro", text: "just text" }, f.ctx),
    Error,
    "heading",
  );
  await assertRejects(
    () => run("slide_insert", { text: "## X" }, f.ctx),
    Error,
    "exactly one of after or before",
  );
  await assertRejects(
    () =>
      run(
        "slide_insert",
        { after: "Intro", before: "B one", text: "## X" },
        f.ctx,
      ),
    Error,
    "exactly one",
  );
  await run("slide_insert", { before: "B one", text: "## X\n\nx" }, f.ctx);
  assertEquals(
    await Deno.readTextFile(`${dir}/s/_b.qmd`),
    "## X\n\nx\n\n## B one\n\nb\n\n## B two\n\nb2\n",
  );
  await assertRejects(
    () => run("slide_move", { slide: "B one", after: "X" }, f.ctx),
    Error,
    "already",
  );
  await Deno.remove(dir, { recursive: true });
});

Deno.test("slide_edit: title keeps attributes, notes keep Ref/CHECK, maxHeight sets the style", () => {
  const lines = [
    '## Old title {.plain}',
    '',
    '![](a.png){.r-stretch}',
    '',
    '[Hirschey et al. 2010, Nature 464:121]{.src}',
    '',
    '::: notes',
    "~2'. Old words.",
    'Ref: Hirschey MD (2010) T. Nature 464:121–125, doi:10.1038/nature08778.',
    'CHECK: panel b?',
    ':::',
    '',
  ];
  const span = slideSpan(lines, 1, null);
  const r = editSlideLines(lines, span, {
    title: "New title",
    notes: "New words.",
    maxHeight: 460,
  }, imageRefs(lines, span));
  assertEquals(r.lines[0], "## New title {.plain}");
  assertEquals(
    r.lines[2],
    '![](a.png){style="max-height: 460px; display: block; margin: 0 auto;"}',
  );
  const notes = r.lines.slice(r.lines.indexOf("::: notes"));
  assertEquals(notes.slice(0, 5), [
    "::: notes",
    "~2'. New words.",
    "Ref: Hirschey MD (2010) T. Nature 464:121–125, doi:10.1038/nature08778.",
    "CHECK: panel b?",
    ":::",
  ]);
  const t = editSlideLines(lines, span, { minutes: 0.5 }, []);
  assertEquals(t.lines.includes("~30 s. Old words."), true);
});
