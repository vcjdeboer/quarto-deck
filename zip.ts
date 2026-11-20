/**
 * The small part of a zip API that the PowerPoint methods need, on fflate
 * (MIT): open an archive, read an entry as text or bytes, replace an entry,
 * and write the archive back. Entry order is kept, so `[Content_Types].xml`
 * stays first.
 * @module
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "npm:fflate@0.8.3";

/** One entry of an archive, read on demand. */
export interface ZipEntry {
  async(type: "string"): Promise<string>;
  async(type: "uint8array"): Promise<Uint8Array>;
}

/** An in-memory zip archive (a .pptx is one). */
export class ZipArchive {
  private constructor(private entries: Record<string, Uint8Array>) {}

  /** Open an archive from its bytes. */
  static loadAsync(bytes: Uint8Array): Promise<ZipArchive> {
    return Promise.resolve(new ZipArchive(unzipSync(bytes)));
  }

  /** Paths of the files in the archive, in archive order. */
  get paths(): string[] {
    return Object.keys(this.entries).filter((p) => !p.endsWith("/"));
  }

  /** Read `path` (null when absent), or write `data` to it. */
  file(path: string): ZipEntry | null;
  file(path: string, data: string | Uint8Array): ZipArchive;
  file(
    path: string,
    data?: string | Uint8Array,
  ): ZipEntry | ZipArchive | null {
    if (data !== undefined) {
      this.entries[path] = typeof data === "string" ? strToU8(data) : data;
      return this;
    }
    const bytes = this.entries[path];
    if (!bytes) return null;
    return {
      async(type: "string" | "uint8array") {
        return Promise.resolve(type === "string" ? strFromU8(bytes) : bytes);
      },
    } as ZipEntry;
  }

  /** The archive as bytes (deflate). */
  generateAsync(
    _opts: { type: "uint8array"; compression?: "DEFLATE" } = {
      type: "uint8array",
    },
  ): Promise<Uint8Array> {
    return Promise.resolve(zipSync(this.entries, { level: 6 }));
  }
}
