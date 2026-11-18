import { randomBytes } from "node:crypto";
import { AppError } from "@/lib/errors";

/**
 * Where encrypted object bytes live. Drivers store opaque blobs under opaque keys: they never see
 * plaintext, file names or owners (envelope encryption and the `objects` index sit above them, in ./index).
 */
export interface ObjectStore {
  /** Creates or replaces the blob at `key`. A reader never observes a partial write. */
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** The blob, or `null` when nothing is stored at `key`. */
  get(key: string): Promise<Buffer | null>;
  /** Removes the blob. Deleting a key that does not exist is not an error. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const MAX_KEY_LENGTH = 512;
/** Slash-separated segments of [A-Za-z0-9._-], each starting with a letter or digit (so no ".", "..", hidden or empty segments). */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/**
 * Every driver validates keys with this before touching its backend, so a key can never address anything
 * outside the store: no absolute paths, no "..", no backslashes, no NUL or other control characters.
 */
export function assertValidStorageKey(key: string): void {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(key) || key.includes("..")) {
    throw new AppError("internal", "Invalid storage key");
  }
}

/**
 * A fresh random key, e.g. "3f/9a1c…". Keys carry no meaning — never a name, an email, an id or a purpose —
 * so a bucket listing reveals nothing about the families whose files it holds. The two-character prefix
 * spreads files over 256 directories.
 */
export function newStorageKey(): string {
  const id = randomBytes(24).toString("hex");
  return `${id.slice(0, 2)}/${id.slice(2)}`;
}

/** In-process store. The default under NODE_ENV=test, so no test ever writes object files into the checkout. */
export class MemoryObjectStore implements ObjectStore {
  private readonly blobs = new Map<string, Buffer>();

  async put(key: string, bytes: Uint8Array): Promise<void> {
    assertValidStorageKey(key);
    this.blobs.set(key, Buffer.from(bytes));
  }

  async get(key: string): Promise<Buffer | null> {
    assertValidStorageKey(key);
    const blob = this.blobs.get(key);
    return blob ? Buffer.from(blob) : null;
  }

  async delete(key: string): Promise<void> {
    assertValidStorageKey(key);
    this.blobs.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    assertValidStorageKey(key);
    return this.blobs.has(key);
  }

  /** Test helpers. */
  keys(): string[] {
    return [...this.blobs.keys()];
  }

  get size(): number {
    return this.blobs.size;
  }
}
