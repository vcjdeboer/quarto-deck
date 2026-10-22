/**
 * Minimal headless-Chrome driver over the DevTools protocol, for walking a
 * rendered reveal.js deck: evaluate JS, set the viewport, take screenshots,
 * print PDFs. No npm dependency — Deno's WebSocket and fetch only.
 * @module
 */

/** Default Chrome binary on macOS. */
export const MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** An open headless Chrome page. */
export interface ChromePage {
  /** Evaluate an expression (promises awaited) and return its value. */
  evaluate<T = unknown>(expression: string): Promise<T>;
  /** Send a raw DevTools command. */
  send(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  /** Screenshot of the viewport. */
  screenshot(format?: "png" | "jpeg", quality?: number): Promise<Uint8Array>;
  /** Navigate and wait for the load event. */
  goto(url: string): Promise<void>;
  /** Kill Chrome and remove its profile. */
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Launch headless Chrome with a fresh profile and attach to its page. */
export async function launchChrome(
  chrome: string = MAC_CHROME,
  size: { width: number; height: number } = { width: 1280, height: 720 },
  scale = 1,
): Promise<ChromePage> {
  const profile = await Deno.makeTempDir({ prefix: "quarto-deck-chrome-" });
  // swamp-quality-ignore deno-command: headless Chrome is the renderer under test; fixed flags, argv array, no shell
  const proc = new Deno.Command(chrome, {
    args: [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      `--window-size=${size.width},${size.height}`,
      "--autoplay-policy=no-user-gesture-required",
      "about:blank",
    ],
    stdout: "null",
    stderr: "null",
  }).spawn();

  // On any failure before the page is handed out, stop Chrome and drop its profile.
  const abort = async (msg: string): Promise<never> => {
    try {
      proc.kill();
    } catch { /* already exited */ }
    await proc.status.catch(() => {});
    await Deno.remove(profile, { recursive: true }).catch(() => {});
    throw new Error(msg);
  };

  // Chrome writes the chosen port to DevToolsActivePort in the profile.
  let port = "";
  for (let i = 0; i < 80 && !port; i++) {
    try {
      port = (await Deno.readTextFile(`${profile}/DevToolsActivePort`))
        .split("\n")[0].trim();
    } catch {
      await sleep(125);
    }
  }
  if (!port) await abort(`Chrome did not start (${chrome})`);
  let targets: Array<{ type: string; webSocketDebuggerUrl: string }> = [];
  for (let i = 0; i < 40 && !targets.length; i++) {
    try {
      targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json())
        .filter((t: { type: string }) => t.type === "page");
    } catch {
      await sleep(125);
    }
  }
  if (!targets.length) await abort("no Chrome page target");

  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error("DevTools websocket failed"));
  }).catch((e) => abort(e.message));
  let nextId = 0;
  const pending = new Map<number, (m: Record<string, unknown>) => void>();
  const waiters: Array<{ method: string; fn: () => void }> = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)!(m);
      pending.delete(m.id);
    } else if (m.method) {
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].method === m.method) waiters.splice(i, 1)[0].fn();
      }
    }
  };
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((res, rej) => {
      const id = ++nextId;
      pending.set(id, (m) => {
        if (m.error) rej(new Error(`${method}: ${JSON.stringify(m.error)}`));
        else res((m.result ?? {}) as Record<string, unknown>);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: size.width,
    height: size.height,
    deviceScaleFactor: scale,
    mobile: false,
  });

  return {
    send,
    async evaluate<T>(expression: string): Promise<T> {
      const r = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }) as {
        result?: { value?: unknown };
        exceptionDetails?: {
          text?: string;
          exception?: { description?: string };
        };
      };
      if (r.exceptionDetails) {
        throw new Error(
          r.exceptionDetails.exception?.description ??
            r.exceptionDetails.text ??
            "evaluation failed",
        );
      }
      return r.result?.value as T;
    },
    async screenshot(format = "png", quality = 80): Promise<Uint8Array> {
      const r = await send("Page.captureScreenshot", {
        format,
        ...(format === "jpeg" ? { quality } : {}),
      }) as { data: string };
      return b64ToBytes(r.data);
    },
    async goto(url: string): Promise<void> {
      const loaded = new Promise<void>((res) =>
        waiters.push({ method: "Page.loadEventFired", fn: res })
      );
      await send("Page.navigate", { url });
      await Promise.race([loaded, sleep(30000)]);
    },
    async close(): Promise<void> {
      try {
        ws.close();
      } catch { /* already closed */ }
      try {
        proc.kill();
      } catch { /* already exited */ }
      await proc.status.catch(() => {});
      await Deno.remove(profile, { recursive: true }).catch(() => {});
    },
  };
}

/** Wait until reveal.js reports ready on the current page. */
export async function waitForReveal(
  page: ChromePage,
  timeoutMs = 30000,
): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await page.evaluate<boolean>(
      "typeof Reveal !== 'undefined' && Reveal.isReady && Reveal.isReady()",
    ).catch(() => false);
    if (ok) return;
    await sleep(200);
  }
  throw new Error("reveal.js did not become ready");
}
