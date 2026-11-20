/**
 * Serve a deck folder over HTTP on 127.0.0.1, so the built deck opens with a
 * real origin (speaker view, iframes and fetches do not work from file://).
 * Reuses a server already listening on the port when it serves this folder;
 * otherwise starts a detached `python3 -m http.server` bound to 127.0.0.1.
 * @module
 */
import { z } from "npm:zod@4";

/** Stored as the `serve` resource. */
export const ServeInfoSchema = z.object({
  dir: z.string(),
  port: z.number(),
  reused: z.boolean(),
  pid: z.number().nullable(),
  main: z.string().nullable(),
  urls: z.array(z.object({
    file: z.string(),
    url: z.string(),
    status: z.number().nullable(),
  })),
  servedAt: z.string(),
  /** Set by `serve stop=true`: the pids that were stopped (empty: none ran). */
  stopped: z.array(z.number()).optional(),
});

/** URL of one file under the server root, each path segment encoded. */
export function fileUrl(port: number, file: string): string {
  return `http://127.0.0.1:${port}/` +
    file.split("/").map(encodeURIComponent).join("/");
}

/** Built decks first: the main deck, then the other `.html` files, sorted. */
export function orderHtml(files: string[], mainHtml?: string): string[] {
  const html = files.filter((f) => /\.html?$/i.test(f)).sort();
  if (!mainHtml || !html.includes(mainHtml)) return html;
  return [mainHtml, ...html.filter((f) => f !== mainHtml)];
}

/** Validate a TCP port number. */
export function checkPort(port: number): number {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`port ${port}: use an unprivileged port (1024-65535)`);
  }
  return port;
}

/** Do two byte arrays hold the same content? */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Body of a GET when it answers 200, else null. */
async function body(url: string, timeoutMs = 3000): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (r.status !== 200) {
      await r.body?.cancel();
      return null;
    }
    return new Uint8Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}

/** HTTP status of a GET, or null when nothing answers. */
async function status(url: string, timeoutMs = 1500): Promise<number | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    await r.body?.cancel();
    return r.status;
  } catch {
    return null;
  }
}

/** Is anything accepting TCP connections on 127.0.0.1:port? */
async function listening(port: number): Promise<boolean> {
  try {
    const c = await Deno.connect({ hostname: "127.0.0.1", port });
    c.close();
    return true;
  } catch {
    return false;
  }
}

/** Result of `serveDeck`. */
export interface ServeResult {
  dir: string;
  port: number;
  /** true when a server was already listening and serving this folder. */
  reused: boolean;
  pid: number | null;
  main: string | null;
  urls: Array<{ file: string; url: string; status: number | null }>;
}

/**
 * Make sure `dir` is served on 127.0.0.1:`port` and return the deck URLs.
 * Throws when the port is taken by something that does not serve `dir`.
 */
export async function serveDeck(opts: {
  dir: string;
  port?: number;
  mainHtml?: string;
  python?: string;
}): Promise<ServeResult> {
  const dir = opts.dir.replace(/\/$/, "");
  const port = checkPort(opts.port ?? 8765);
  const files: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile) files.push(e.name);
  }
  const html = orderHtml(files, opts.mainHtml);
  if (!html.length) {
    throw new Error(`no .html files in ${dir}; run render first`);
  }
  // The probe is a deck file of this folder. Another folder may hold a file of
  // the same name (a copy of the deck), so the served bytes must match too.
  const probe = fileUrl(port, html[0]);
  const local = await Deno.readFile(`${dir}/${html[0]}`);
  let reused = false;
  let pid: number | null = null;
  if (await listening(port)) {
    const served = await body(probe);
    if (!served || !sameBytes(served, local)) {
      throw new Error(
        `port ${port} is in use but does not serve ${dir} (${probe} ${
          served ? "differs from the local file" : "is not answered with 200"
        }); pass another port`,
      );
    }
    reused = true;
  } else {
    // swamp-quality-ignore deno-command: a detached static file server has no swamp primitive; argv array, no shell, bound to 127.0.0.1
    const child = new Deno.Command(opts.python ?? "python3", {
      args: [
        "-m",
        "http.server",
        String(port),
        "--bind",
        "127.0.0.1",
        "--directory",
        dir,
      ],
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).spawn();
    child.unref();
    pid = child.pid;
    let st: number | null = null;
    for (let i = 0; i < 50 && st !== 200; i++) {
      await new Promise((r) => setTimeout(r, 100));
      st = await status(probe);
    }
    if (st !== 200) {
      try {
        child.kill();
      } catch { /* already exited */ }
      throw new Error(`static server on port ${port} did not come up`);
    }
  }
  const urls = [];
  for (const file of html) {
    const url = fileUrl(port, file);
    urls.push({ file, url, status: await status(url) });
  }
  return {
    dir,
    port,
    reused,
    pid,
    main: opts.mainHtml && html[0] === opts.mainHtml ? urls[0].url : null,
    urls,
  };
}

/**
 * Is `command` (a `ps -o command=` line) the static server `serveDeck` starts
 * for `dir` on `port`? Only such a process is stopped.
 */
export function isDeckServer(
  command: string,
  dir: string,
  port: number,
): boolean {
  const argv = command.trim().split(/\s+/);
  const at = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const m = argv.indexOf("-m");
  return m >= 0 && argv[m + 1] === "http.server" &&
    argv[m + 2] === String(port) &&
    at("--directory")?.replace(/\/$/, "") === dir.replace(/\/$/, "");
}

async function output(cmd: string, args: string[]): Promise<string> {
  try {
    // swamp-quality-ignore deno-command: lsof/ps lookups for the server pid; argv array, no shell
    const r = await new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "null",
    }).output();
    return new TextDecoder().decode(r.stdout);
  } catch {
    return "";
  }
}

/**
 * Stop the static server that serves `dir` on `port`. Returns the pids that
 * were sent SIGTERM; empty when nothing listens. Throws when the listener on
 * the port is some other process.
 */
export async function stopServe(opts: { dir: string; port?: number }): Promise<
  number[]
> {
  const dir = opts.dir.replace(/\/$/, "");
  const port = checkPort(opts.port ?? 8765);
  const pids = (await output("lsof", [
    "-nP",
    "-t",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
  ])).split(/\s+/).filter(Boolean).map(Number);
  const stopped: number[] = [];
  for (const pid of pids) {
    const command = await output("ps", ["-o", "command=", "-p", String(pid)]);
    if (!isDeckServer(command, dir, port)) {
      throw new Error(
        `port ${port} is held by pid ${pid} (${command.trim()}), not this deck's server; not stopping it`,
      );
    }
    Deno.kill(pid, "SIGTERM");
    stopped.push(pid);
  }
  for (let i = 0; i < 30 && stopped.length && await listening(port); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return stopped;
}
