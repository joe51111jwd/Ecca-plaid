/**
 * npm run evidence:verify -- <record.json> [--jwks <file-or-url>] [--json]
 *
 * Checks a signed evidence record (the JSON half of an evidence pack) and prints PASS or FAIL.
 *
 *   <record.json>        The signed record: an object with "record" and "signature".
 *   --jwks <file-or-url> The public keys to check against: a saved copy of /.well-known/jwks.json (works
 *                        offline) or its URL. Without it, the record is checked against this deployment's own
 *                        signing key (EVIDENCE_SIGNING_PRIVATE_KEY, or the development key in ECCA_DATA_DIR).
 *   --json               Print the result as one JSON object instead of the report.
 *
 * Exit status: 0 the record is intact and correctly signed; 1 it is not; 2 the check could not be run (bad
 * arguments, unreadable file, unreachable key set).
 *
 * What PASS means: the "record" part is byte-for-byte what was signed (after canonicalization), and the
 * signature was made with the private half of a key in the key set you supplied. It says nothing about
 * whether that key set is the right one, so get it from the issuer's own site.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseJsonStrict } from "@/engine/evidence/json-strict";
import { platformJwks } from "@/engine/evidence/platform";
import { canonicalRecordBytes, verifySignedEvidence, type EvidenceVerificationKeys } from "@/engine/evidence/record";
import { normalizeText } from "@/engine/evidence/text";
import type { EvidenceRecord, EvidenceVerification } from "@/engine/evidence/types";
import { sha256Hex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { AppError, badRequest, isAppError } from "@/lib/errors";

export interface VerifyEvidenceIo {
  /** Directory that paths given on the command line are resolved against. */
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Used for `--jwks <url>`. Injected so tests never touch the network. */
  fetch: (url: string, init: { signal: AbortSignal; redirect: "error" }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
}

export const EXIT = Object.freeze({ pass: 0, fail: 1, notRun: 2 });

const USAGE = "Usage: npm run evidence:verify -- <record.json> [--jwks <file-or-url>] [--json]";
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
/* File name `getSigningKey()` in src/lib/crypto gives the development key. Only used to decide whether a local key exists. */
const DEV_SIGNING_KEY_FILE = "dev-evidence-signing.pem";

interface KeySet {
  keys: EvidenceVerificationKeys;
  description: string;
}

function readTextFile(path: string, what: string): string {
  if (!existsSync(path)) throw badRequest(`${what} not found: ${path}`);
  const stats = statSync(path);
  if (!stats.isFile()) throw badRequest(`${what} is not a file: ${path}`);
  if (stats.size > MAX_FILE_BYTES) throw badRequest(`${what} is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB: ${path}`);
  return readFileSync(path, "utf8");
}

function countKeys(value: unknown): number {
  if (typeof value === "object" && value !== null && Array.isArray((value as { keys?: unknown }).keys)) return (value as { keys: unknown[] }).keys.length;
  return 1;
}

function parseKeySet(text: string, source: string): KeySet {
  let parsed: unknown;
  try {
    parsed = parseJsonStrict(text);
  } catch (error) {
    throw badRequest(`The key set from ${source} is not usable: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
  const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  const looksLikeJwks = isObject && Array.isArray((parsed as { keys?: unknown }).keys);
  const looksLikeJwk = isObject && typeof (parsed as { kty?: unknown }).kty === "string";
  if (!looksLikeJwks && !looksLikeJwk) throw badRequest(`The key set from ${source} is not a JWKS document ({ "keys": [...] }) or a single JWK`);
  const count = countKeys(parsed);
  return { keys: parsed as EvidenceVerificationKeys, description: `${source} (${count} ${count === 1 ? "key" : "keys"})` };
}

async function loadKeySet(jwks: string | undefined, io: VerifyEvidenceIo): Promise<KeySet> {
  if (jwks === undefined) {
    // Checking against "our own key" must not create one: getSigningKey() would generate a development key.
    const hasLocalKey = Boolean(env().EVIDENCE_SIGNING_PRIVATE_KEY) || existsSync(join(env().ECCA_DATA_DIR, DEV_SIGNING_KEY_FILE));
    if (!hasLocalKey) throw badRequest(`No key set given and this deployment has no evidence signing key. Pass --jwks <file-or-url>.\n${USAGE}`);
    return { keys: platformJwks(), description: "this deployment's evidence signing key" };
  }
  if (/^https?:\/\//i.test(jwks)) {
    let url: URL;
    try {
      url = new URL(jwks);
    } catch {
      throw badRequest(`Not a valid key set URL: ${jwks}`);
    }
    // Over plain HTTP anyone on the path can swap in their own keys and make a forged record PASS. Only a
    // server on this machine is exempt, for checking a development deployment.
    if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
      throw badRequest(`The key set must be fetched over HTTPS (or from a saved file): ${jwks}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      // A redirect could hand the check to someone else's keys, so it is treated as a failure to fetch.
      const response = await io.fetch(jwks, { signal: controller.signal, redirect: "error" });
      if (!response.ok) throw badRequest(`Could not fetch the key set from ${jwks}: HTTP ${response.status}`);
      const body = await response.text();
      if (body.length > MAX_FILE_BYTES) throw badRequest(`The key set from ${jwks} is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB`);
      return parseKeySet(body, jwks);
    } catch (error) {
      if (isAppError(error)) throw error;
      throw badRequest(`Could not fetch the key set from ${jwks}: ${error instanceof Error ? error.message : "request failed"}`);
    } finally {
      clearTimeout(timer);
    }
  }
  const path = resolve(io.cwd, jwks);
  return parseKeySet(readTextFile(path, "Key set file"), path);
}

/** Text from an unverified file goes to a terminal: no control characters, no surprises in length. */
function printable(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "(not stated)";
  const text = normalizeText(String(value));
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function field(object: unknown, ...path: string[]): unknown {
  let current: unknown = object;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function recomputedHash(signed: unknown): string | null {
  const record = field(signed, "record");
  if (typeof record !== "object" || record === null) return null;
  try {
    return sha256Hex(canonicalRecordBytes(record as EvidenceRecord));
  } catch {
    return null;
  }
}

function report(file: string, keySet: KeySet, signed: unknown, result: EvidenceVerification, parseProblem: string | null): string {
  const lines: Array<[string, string]> = [
    ["File", file],
    ["Keys", keySet.description],
  ];
  if (parseProblem === null) {
    const stated = result.valid ? "" : " (as stated in the file; not verified)";
    const hash = recomputedHash(signed);
    lines.push(
      ["Verification", `${printable(field(signed, "record", "verification_id"))}${stated}`],
      ["Mode", `${printable(field(signed, "record", "mode"))}${stated}`],
      ["Decision", `${printable(field(signed, "record", "decision", "status"))}, ${printable(field(signed, "record", "decision", "method"))} method${stated}`],
      ["Prepared for", `${printable(field(signed, "record", "sgo", "name"))}${stated}`],
      ["Generated", `${printable(field(signed, "record", "generated_at"))}${stated}`],
      ["Key id", result.kid === null ? "(not stated)" : printable(result.kid)],
      ["Record SHA-256", hash === null ? "(cannot be computed)" : `${hash} (computed from the file)`],
    );
  }
  const width = Math.max(...lines.map(([label]) => label.length));
  const body = lines.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`).join("\n");
  const verdict = result.valid
    ? `PASS  The record is unchanged since it was signed, and the signature is a valid Ed25519 signature by key ${printable(result.kid)}.`
    : `FAIL  ${result.reason}: ${parseProblem ?? result.message}`;
  return `Evidence record check\n${body}\n\n${verdict}\n`;
}

export async function runVerifyEvidence(argv: string[], io: VerifyEvidenceIo): Promise<number> {
  try {
    let parsed;
    try {
      parsed = parseArgs({ args: argv, allowPositionals: true, options: { jwks: { type: "string" }, json: { type: "boolean", default: false }, help: { type: "boolean", short: "h", default: false } } });
    } catch (error) {
      throw badRequest(`${error instanceof Error ? error.message : "Invalid arguments"}\n${USAGE}`);
    }
    if (parsed.values.help) {
      io.stdout(`${USAGE}\n`);
      return EXIT.pass;
    }
    if (parsed.positionals.length !== 1) throw badRequest(`Give exactly one signed record file.\n${USAGE}`);

    const file = resolve(io.cwd, parsed.positionals[0]);
    const text = readTextFile(file, "Signed record file");
    const keySet = await loadKeySet(parsed.values.jwks, io);

    let signed: unknown = null;
    let parseProblem: string | null = null;
    let result: EvidenceVerification;
    try {
      signed = parseJsonStrict(text);
      result = verifySignedEvidence(signed, keySet.keys);
    } catch (error) {
      if (!isAppError(error)) throw error;
      parseProblem = error.message;
      result = { valid: false, reason: "malformed", message: error.message, kid: null };
    }

    if (parsed.values.json) {
      io.stdout(
        `${JSON.stringify({
          result: result.valid ? "pass" : "fail",
          reason: result.reason ?? null,
          message: result.valid ? null : (parseProblem ?? result.message ?? null),
          kid: result.kid,
          record_sha256: parseProblem === null ? recomputedHash(signed) : null,
          verification_id: result.valid ? (field(signed, "record", "verification_id") ?? null) : null,
          file,
          keys: keySet.description,
        })}\n`,
      );
    } else {
      io.stdout(report(file, keySet, signed, result, parseProblem));
    }
    return result.valid ? EXIT.pass : EXIT.fail;
  } catch (error) {
    if (error instanceof AppError || isAppError(error)) {
      io.stderr(`evidence:verify could not run: ${error.message}\n`);
      return EXIT.notRun;
    }
    throw error;
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  runVerifyEvidence(process.argv.slice(2), {
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    fetch: (url, init) => fetch(url, init),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = EXIT.notRun;
    },
  );
}
