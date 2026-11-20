import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  checkPort,
  fileUrl,
  isDeckServer,
  orderHtml,
  sameBytes,
  serveDeck,
} from "./serve.ts";

Deno.test("isDeckServer matches only this folder's http.server on the port", () => {
  const cmd =
    "/usr/bin/python3 -m http.server 8765 --bind 127.0.0.1 --directory /d/deck";
  assertEquals(isDeckServer(cmd, "/d/deck", 8765), true);
  assertEquals(isDeckServer(cmd, "/d/deck/", 8765), true);
  assertEquals(isDeckServer(cmd, "/d/other", 8765), false);
  assertEquals(isDeckServer(cmd, "/d/deck", 8766), false);
  assertEquals(isDeckServer("node server.js 8765", "/d/deck", 8765), false);
  const spaced =
    "python3 -m http.server 8765 --bind 127.0.0.1 --directory /Users/a/My Decks/talk";
  assertEquals(isDeckServer(spaced, "/Users/a/My Decks/talk", 8765), true);
  assertEquals(isDeckServer(spaced, "/Users/a/My", 8765), false);
});

Deno.test("fileUrl encodes each path segment", () => {
  assertEquals(
    fileUrl(8765, "glycolysis.html"),
    "http://127.0.0.1:8765/glycolysis.html",
  );
  assertEquals(
    fileUrl(8765, "day 2/a#b.html"),
    "http://127.0.0.1:8765/day%202/a%23b.html",
  );
});

Deno.test("orderHtml puts the main deck first and drops non-html", () => {
  assertEquals(
    orderHtml(["b.html", "talk.html", "x.pdf", "a.htm"], "talk.html"),
    ["talk.html", "a.htm", "b.html"],
  );
  assertEquals(orderHtml(["b.html", "a.html"], "missing.html"), [
    "a.html",
    "b.html",
  ]);
});

Deno.test("checkPort refuses privileged and invalid ports", () => {
  assertEquals(checkPort(8765), 8765);
  assertThrows(() => checkPort(80));
  assertThrows(() => checkPort(70000));
  assertThrows(() => checkPort(8765.5));
});

Deno.test("sameBytes", () => {
  const e = new TextEncoder();
  assertEquals(sameBytes(e.encode("abc"), e.encode("abc")), true);
  assertEquals(sameBytes(e.encode("abc"), e.encode("abd")), false);
  assertEquals(sameBytes(e.encode("ab"), e.encode("abc")), false);
});

async function withServer(
  content: string,
  fn: (port: number) => Promise<void>,
): Promise<void> {
  const ac = new AbortController();
  const srv = Deno.serve(
    { hostname: "127.0.0.1", port: 0, signal: ac.signal, onListen: () => {} },
    (req) =>
      new URL(req.url).pathname === "/talk.html"
        ? new Response(content)
        : new Response("no", { status: 404 }),
  );
  try {
    await fn(srv.addr.port);
  } finally {
    ac.abort();
    await srv.finished;
  }
}

Deno.test("serveDeck reuses a server that serves this folder", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qd-serve-" });
  await Deno.writeTextFile(`${dir}/talk.html`, "<p>deck</p>");
  await withServer("<p>deck</p>", async (port) => {
    if (port < 1024) return; // checkPort refuses it; nothing to test
    const r = await serveDeck({ dir, port, mainHtml: "talk.html" });
    assertEquals(r.reused, true);
    assertEquals(r.pid, null);
    assertEquals(r.main, `http://127.0.0.1:${port}/talk.html`);
    assertEquals(r.urls, [{ file: "talk.html", url: r.main!, status: 200 }]);
  });
  await Deno.remove(dir, { recursive: true });
});

Deno.test("serveDeck refuses a port serving another copy of the deck", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qd-serve-" });
  await Deno.writeTextFile(`${dir}/talk.html`, "<p>deck v2</p>");
  await withServer("<p>deck v1</p>", async (port) => {
    if (port < 1024) return;
    await assertRejects(
      () => serveDeck({ dir, port, mainHtml: "talk.html" }),
      Error,
      "does not serve",
    );
  });
  await Deno.remove(dir, { recursive: true });
});

Deno.test("serveDeck needs a built deck", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qd-serve-" });
  await assertRejects(() => serveDeck({ dir, port: 8799 }), Error, "no .html");
  await Deno.remove(dir, { recursive: true });
});
