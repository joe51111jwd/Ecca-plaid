import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
import { assertValidStorageKey, type ObjectStore } from "./store";

export type S3StoreCommand = PutObjectCommand | GetObjectCommand | DeleteObjectCommand | HeadObjectCommand;

/** The one method of `S3Client` this driver uses, so tests can inject a fake. */
export interface S3ClientLike {
  send(command: S3StoreCommand): Promise<unknown>;
}

export interface S3StoreConfig {
  client: S3ClientLike;
  bucket: string;
  /** Prepended to every key, e.g. "objects/". Default: none. */
  prefix?: string;
}

function errorName(e: unknown): string | undefined {
  return typeof e === "object" && e !== null ? (e as { name?: string }).name : undefined;
}

/**
 * "This key does not exist" as reported by GetObject (`NoSuchKey`) and HeadObject (`NotFound`). Deliberately
 * not "any 404": a missing bucket (`NoSuchBucket`) is a configuration error and must surface as one, not
 * read as "the object is gone".
 */
function isMissingKey(e: unknown): boolean {
  const name = errorName(e);
  return name === "NoSuchKey" || name === "NotFound";
}

/**
 * Object store on S3 or any S3-compatible service (R2, MinIO, Backblaze B2, …). Blobs are already
 * envelope-encrypted by the layer above; server-side encryption on the bucket is welcome but not relied on.
 */
export class S3Store implements ObjectStore {
  private readonly client: S3ClientLike;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: S3StoreConfig) {
    if (!config.bucket) throw new Error("S3Store requires a bucket");
    const prefix = config.prefix ?? "";
    if (prefix !== "" && !/^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)+$/.test(prefix)) {
      throw new Error('S3Store prefix must look like "dir/" or "dir/sub/"');
    }
    this.client = config.client;
    this.bucket = config.bucket;
    this.prefix = prefix;
  }

  /** Builds the production store from S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY. */
  static fromEnv(): S3Store {
    const e = env();
    if (!e.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_PROVIDER=s3");
    if (Boolean(e.S3_ACCESS_KEY_ID) !== Boolean(e.S3_SECRET_ACCESS_KEY)) {
      throw new Error("Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither (to use the platform's default credentials)");
    }
    const client = new S3Client({
      region: e.S3_REGION || "us-east-1",
      // A custom endpoint means an S3-compatible service; those generally expect path-style addressing.
      ...(e.S3_ENDPOINT ? { endpoint: e.S3_ENDPOINT, forcePathStyle: true } : {}),
      ...(e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY ? { credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY } } : {}),
      // Newer SDKs add CRC32 checksums to every request by default, which several S3-compatible services
      // reject. Integrity is already guaranteed end to end by AES-GCM and the plaintext SHA-256.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    return new S3Store({ client, bucket: e.S3_BUCKET, prefix: "objects/" });
  }

  private objectKey(key: string): string {
    assertValidStorageKey(key);
    return `${this.prefix}${key}`;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: bytes,
        ContentLength: bytes.byteLength,
        // Ciphertext: the real content type lives in the `objects` row, not on the bucket.
        ContentType: "application/octet-stream",
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    let out: GetObjectCommandOutput;
    try {
      out = (await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }))) as GetObjectCommandOutput;
    } catch (e) {
      if (isMissingKey(e)) return null;
      throw e;
    }
    if (!out.Body) throw new Error("S3 returned an object without a body");
    return Buffer.from(await out.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
    } catch (e) {
      // S3 answers 204 for a missing key; some compatible services answer NoSuchKey instead.
      if (errorName(e) === "NoSuchKey") return;
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
      return true;
    } catch (e) {
      if (isMissingKey(e)) return false;
      throw e;
    }
  }
}
