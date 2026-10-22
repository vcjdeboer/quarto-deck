import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { hasLine, model } from "./quarto_deck.ts";

/** A minimal method context backed by a map, enough for outline/slide_add/journal. */
function fakeCtx(dir: string) {
  const store = new Map<string, Record<string, unknown>>();
  const logs: string[] = [];
  return {
    store,
    logs,
    ctx: {
      globalArgs: {
        dir,
        main: "talk.qmd",
        slotMinutes: 5,
        chrome: "chrome",
        quarto: "quarto",
        sourcesDir: "sources",
        assetsDir: "assets",
      },
      logger: { info: (m: string) => logs.push(m) },
      writeResource: (_spec: string, name: string, data: Record<string, unknown>) => {
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

async function tempDeck(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "qd-test-" });
  await Deno.writeTextFile(
    `${dir}/talk.qmd`,
    '---\ntitle: "T"\n---\n\n## One\n\n::: notes\n~2\'. x\n:::\n\n{{< include part.qmd >}}\n',
  );
  await Deno.writeTextFile(`${dir}/part.qmd`, "## Two\n\n![](missing.png)\n");
  return dir;
}

// deno-lint-ignore no-explicit-any
const run = (m: string, args: unknown, ctx: unknown) => (model.methods as any)[m].execute(args, ctx);

Deno.test("outline execute writes the outline and logs entry + result", async () => {
  const dir = await tempDeck();
  const f = fakeCtx(dir);
  await run("outline", {}, f.ctx);
  const o = f.store.get("outline")!;
  assertEquals(o.visibleSlides, 2);
  assertEquals(o.minutesPlanned, 2);
  assertEquals((o.missingImages as unknown[]).length, 1);
  assertStringIncludes(f.logs[0], "{method} on {main}");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("slide_add writes once, journals, and refuses a duplicate", async () => {
  const dir = await tempDeck();
  const f = fakeCtx(dir);
  const args = {
    kind: "paper",
    file: "part.qmd",
    title: "Cells need glycolysis",
    image: "assets/x.png",
    citation: "A 1959",
    minutes: 1,
    notes: "Say it.",
  };
  await run("slide_add", args, f.ctx);
  const text = await Deno.readTextFile(`${dir}/part.qmd`);
  assertStringIncludes(text, "## Cells need glycolysis");
  assertEquals((f.store.get("journal")!.entries as unknown[]).length, 1);
  await assertRejects(() => run("slide_add", args, f.ctx), Error, "already has");
  assertEquals(await Deno.readTextFile(`${dir}/part.qmd`), text);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("slide_add paper without figure or image fails before writing", async () => {
  const dir = await tempDeck();
  const f = fakeCtx(dir);
  await assertRejects(
    () => run("slide_add", { kind: "paper", file: "part.qmd", title: "X", minutes: 1, notes: "" }, f.ctx),
    Error,
    "needs figure",
  );
  assertEquals(f.store.size, 0);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("source_find without a registered source fails clearly", async () => {
  const f = fakeCtx("/nonexistent");
  await assertRejects(() => run("source_find", { key: "x", query: "q" }, f.ctx), Error, "not registered");
});

Deno.test("hasLine ignores edge spaces only", () => {
  assertEquals(hasLine("## A \nx", "## A"), true);
  assertEquals(hasLine("## AB", "## A"), false);
});
