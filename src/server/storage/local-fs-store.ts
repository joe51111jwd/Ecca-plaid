import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { AppError } from "@/lib/errors";
import { assertValidStorageKey, type ObjectStore } from "./store";

function errno(e: unknown): string | undefined {
  return typeof e === "object" && e !== null ? (e as NodeJS.ErrnoException).code : undefined;
}

/**
 * Object store on the local filesystem (development default: `${ECCA_DATA_DIR}/objects`).
 *
 * Writes are atomic: bytes go to a temporary file in `<root>/.tmp` (same filesystem), are flushed to disk,
 * and are then renamed into place, so a crash leaves either the old blob or the new one, never half of one.
 */
export class LocalFsStore implements ObjectStore {
  readonly root: string;
  private readonly tmpDir: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
    // Keys cannot start with "." (see assertValidStorageKey), so no key can ever collide with this directory.
    this.tmpDir = join(this.root, ".tmp");
  }

  private pathFor(key: string): string {
    assertValidStorageKey(key);
    const path = resolve(this.root, ...key.split("/"));
    // Belt and braces: even if key validation were ever loosened, nothing outside the root is reachable.
    const prefix = this.root.endsWith(sep) ? this.root : this.root + sep;
    if (!path.startsWith(prefix)) throw new AppError("internal", "Invalid storage key");
    return path;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await mkdir(this.tmpDir, { recursive: true, mode: 0o700 });
    const tmp = join(this.tmpDir, `${randomBytes(12).toString("hex")}.part`);
    let handle: FileHandle | undefined;
    try {
      handle = await open(tmp, "wx", 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(tmp, target);
    } catch (e) {
      await handle?.close().catch(() => undefined);
      await rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch (e) {
      if (errno(e) === "ENOENT" || errno(e) === "EISDIR" || errno(e) === "ENOTDIR") return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (e) {
      if (errno(e) === "ENOENT" || errno(e) === "ENOTDIR") return;
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(key))).isFile();
    } catch (e) {
      if (errno(e) === "ENOENT" || errno(e) === "ENOTDIR") return false;
      throw e;
    }
  }
}
