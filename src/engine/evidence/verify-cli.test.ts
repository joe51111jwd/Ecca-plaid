import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT, runVerifyEvidence, type VerifyEvidenceIo } from "../../../scripts/verify-evidence";
import { buildEvidenceRecord, signEvidenceRecord } from "./record";
import { syntheticCategoricalEligibleInput, syntheticDirectReviewedInput } from "./synthetic-fixtures";
import { generateTestSigningKey, jwksOf } from "./test-support";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const key = generateTestSigningKey("cli-test-key");
const otherKey = generateTestSigningKey("cli-other-key");
const signed = signEvidenceRecord(buildEvidenceRecord(syntheticCategoricalEligibleInput()), key);

let dir = "";
const file = (name: string) => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "evidence-verify-test-"));
  writeFileSync(file("record.json"), JSON.stringify(signed, null, 2));
  writeFileSync(file("direct.json"), JSON.stringify(signEvidenceRecord(buildEvidenceRecord(syntheticDirectReviewedInput()), key)));
  writeFileSync(file("jwks.json"), JSON.stringify(jwksOf(key)));
  writeFileSync(file("jwk.json"), JSON.stringify(jwksOf(key).keys[0]));
  writeFileSync(file("other-jwks.json"), JSON.stringify(jwksOf(otherKey)));

  const tampered = structuredClone(signed);
  tampered.record.household.size = 3;
  writeFileSync(file("tampered.json"), JSON.stringify(tampered));

  const forged = structuredClone(signed);
  forged.signature.value = signEvidenceRecord(forged.record, { kid: key.kid, privateKey: otherKey.privateKey }).signature.value;
  writeFileSync(file("forged.json"), JSON.stringify(forged));

  // The genuine record with a second, altered "record" member placed first: a reader sees one, JSON.parse the other.
  const text = JSON.stringify(signed);
  const altered = structuredClone(signed.record);
  altered.decision.status = "ineligible";
  writeFileSync(file("duplicate.json"), `{"record":${JSON.stringify(altered)},${text.slice(1)}`);

  writeFileSync(file("not-json.json"), "{ this is not json");
  writeFileSync(file("empty.json"), "");
  writeFileSync(file("array.json"), "[1,2,3]");
  writeFileSync(file("bad-jwks.json"), '{"keys":"none"}');
  writeFileSync(file("broken-jwks.json"), "{");

  const hostile = structuredClone(signed) as unknown as { record: Record<string, unknown>; signature: Record<string, unknown> };
  hostile.record.verification_id = `ver_x${String.fromCharCode(0x1b)}[2J${String.fromCharCode(0x1b)}[31mPASS${String.fromCharCode(0x07)}\nPASS  forged line`;
  hostile.record.mode = { toString: "x" };
  hostile.signature.kid = `kid${String.fromCharCode(0x1b)}[0m\rPASS`;
  writeFileSync(file("hostile.json"), JSON.stringify(hostile));
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

interface Run {
  code: number;
  out: string;
  err: string;
  fetched: string[];
}

async function run(args: string[], fetchImpl?: VerifyEvidenceIo["fetch"]): Promise<Run> {
  let out = "";
  let err = "";
  const fetched: string[] = [];
  const code = await runVerifyEvidence(args, {
    cwd: dir,
    stdout: (text) => void (out += text),
    stderr: (text) => void (err += text),
    fetch: async (url, init) => {
      fetched.push(url);
      if (!fetchImpl) throw new Error("the network must not be used in this test");
      return fetchImpl(url, init);
    },
  });
  return { code, out, err, fetched };
}

describe("evidence:verify (in process)", () => {
  it("prints PASS and exits 0 for an intact record, offline, with a local JWKS file", async () => {
    const result = await run(["record.json", "--jwks", "jwks.json"]);
    expect(result.code).toBe(EXIT.pass);
    expect(result.err).toBe("");
    expect(result.fetched).toEqual([]);
    expect(result.out).toMatch(/^Evidence record check\n/);
    expect(result.out).toContain(`File            ${file("record.json")}`);
    expect(result.out).toContain(`Keys            ${file("jwks.json")} (1 key)`);
    expect(result.out).toContain("Verification    ver_SYNTHETICcategorical01\n");
    expect(result.out).toContain("Mode            test\n");
    expect(result.out).toContain("Decision        eligible, categorical method\n");
    expect(result.out).toContain("Key id          cli-test-key\n");
    expect(result.out).toContain(`Record SHA-256  ${signed.signature.record_sha256} (computed from the file)`);
    expect(result.out).toMatch(/\nPASS {2}The record is unchanged since it was signed, and the signature is a valid Ed25519 signature by key cli-test-key\.\n$/);
    expect(result.out).not.toContain("FAIL");
    expect(result.out).not.toContain("not verified");
  });

  it("accepts a single JWK, an absolute path and a compact file", async () => {
    expect((await run([file("direct.json"), "--jwks", file("jwk.json")])).code).toBe(EXIT.pass);
    expect((await run(["--jwks=jwks.json", "direct.json"])).out).toContain("Decision        eligible, direct method");
  });

  it("prints FAIL and exits 1 when the record was changed", async () => {
    const result = await run(["tampered.json", "--jwks", "jwks.json"]);
    expect(result.code).toBe(EXIT.fail);
    expect(result.out).toMatch(/\nFAIL {2}record_hash_mismatch: The record does not match its SHA-256 hash: it was changed after it was signed\.\n$/);
    expect(result.out).not.toMatch(/^PASS/m);
    // Nothing read from a failed file is presented as fact.
    expect(result.out).toContain("Verification    ver_SYNTHETICcategorical01 (as stated in the file; not verified)");
    expect(result.out).not.toContain(`${signed.signature.record_sha256} (computed`);
  });

  it.each([
    ["forged.json", "jwks.json", "bad_signature"],
    ["record.json", "other-jwks.json", "unknown_kid"],
    ["duplicate.json", "jwks.json", "malformed"],
    ["not-json.json", "jwks.json", "malformed"],
    ["empty.json", "jwks.json", "malformed"],
    ["array.json", "jwks.json", "malformed"],
    ["jwks.json", "jwks.json", "malformed"],
  ])("%s against %s fails with %s", async (record, keys, reason) => {
    const result = await run([record, "--jwks", keys]);
    expect(result.code).toBe(EXIT.fail);
    expect(result.out).toMatch(new RegExp(`\\nFAIL {2}${reason}: .+\\n$`));
    expect(result.out).not.toMatch(/^PASS/m);
  });

  it("explains a repeated member name", async () => {
    const result = await run(["duplicate.json", "--jwks", "jwks.json"]);
    expect(result.out).toContain('FAIL  malformed: The JSON repeats the member name "record". A signed file must not say one thing twice.');
  });

  it("exits 2 without a verdict when the check cannot run", async () => {
    const cases: Array<[string[], RegExp]> = [
      [[], /Give exactly one signed record file/],
      [["record.json", "direct.json", "--jwks", "jwks.json"], /Give exactly one signed record file/],
      [["missing.json", "--jwks", "jwks.json"], /Signed record file not found/],
      [[".", "--jwks", "jwks.json"], /is not a file/],
      [["record.json", "--jwks", "missing-jwks.json"], /Key set file not found/],
      [["record.json", "--jwks", "bad-jwks.json"], /not a JWKS document/],
      [["record.json", "--jwks", "broken-jwks.json"], /not usable: Not valid JSON/],
      [["record.json", "--jwks", "array.json"], /not a JWKS document/],
      [["record.json", "--jwks"], /Usage:/],
      [["record.json", "--no-such-flag"], /Usage:/],
    ];
    for (const [args, message] of cases) {
      const result = await run(args);
      expect(result.code, args.join(" ")).toBe(EXIT.notRun);
      expect(result.err, args.join(" ")).toMatch(/^evidence:verify could not run: /);
      expect(result.err).toMatch(message);
      expect(result.out).toBe("");
    }
  });

  it("fetches the key set from a URL without following redirects", async () => {
    const calls: Array<{ redirect: string }> = [];
    const ok = await run(["record.json", "--jwks", "https://issuer.example.org/.well-known/jwks.json"], async (_url, init) => {
      calls.push({ redirect: init.redirect });
      return { ok: true, status: 200, text: async () => JSON.stringify(jwksOf(otherKey, key)) };
    });
    expect(ok.code).toBe(EXIT.pass);
    expect(ok.fetched).toEqual(["https://issuer.example.org/.well-known/jwks.json"]);
    expect(calls).toEqual([{ redirect: "error" }]);
    expect(ok.out).toContain("Keys            https://issuer.example.org/.well-known/jwks.json (2 keys)");

    const notFound = await run(["record.json", "--jwks", "https://issuer.example.org/jwks.json"], async () => ({ ok: false, status: 404, text: async () => "" }));
    expect(notFound.code).toBe(EXIT.notRun);
    expect(notFound.err).toContain("Could not fetch the key set from https://issuer.example.org/jwks.json: HTTP 404");

    const offline = await run(["record.json", "--jwks", "http://issuer.example.org/jwks.json"], async () => {
      throw new Error("getaddrinfo ENOTFOUND issuer.example.org");
    });
    expect(offline.code).toBe(EXIT.notRun);
    expect(offline.err).toContain("Could not fetch the key set from http://issuer.example.org/jwks.json: getaddrinfo ENOTFOUND issuer.example.org");

    const html = await run(["record.json", "--jwks", "https://issuer.example.org/jwks.json"], async () => ({ ok: true, status: 200, text: async () => "<html>sign in</html>" }));
    expect(html.code).toBe(EXIT.notRun);
    expect(html.err).toContain("is not usable");
  });

  it("never prints control characters from the file it is checking", async () => {
    const result = await run(["hostile.json", "--jwks", "jwks.json"]);
    expect(result.code).toBe(EXIT.fail);
    // Tab and line feed are the only control characters the report itself uses.
    expect(result.out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
    expect(result.out.match(/^PASS/gm)).toBeNull();
    expect(result.out.trimEnd().split("\n").pop()).toMatch(/^FAIL {2}/);
    expect(result.out).toContain("Mode            (not stated)");
  });

  it("prints one JSON object with --json", async () => {
    const pass = await run(["record.json", "--jwks", "jwks.json", "--json"]);
    expect(pass.code).toBe(EXIT.pass);
    expect(JSON.parse(pass.out)).toEqual({
      result: "pass",
      reason: null,
      message: null,
      kid: "cli-test-key",
      record_sha256: signed.signature.record_sha256,
      verification_id: "ver_SYNTHETICcategorical01",
      file: file("record.json"),
      keys: `${file("jwks.json")} (1 key)`,
    });
    const fail = await run(["tampered.json", "--jwks", "jwks.json", "--json"]);
    expect(fail.code).toBe(EXIT.fail);
    expect(JSON.parse(fail.out)).toMatchObject({ result: "fail", reason: "record_hash_mismatch", kid: "cli-test-key", verification_id: null });
    const broken = await run(["not-json.json", "--jwks", "jwks.json", "--json"]);
    expect(JSON.parse(broken.out)).toMatchObject({ result: "fail", reason: "malformed", kid: null, record_sha256: null });
  });

  it("prints usage with --help", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.out).toBe("Usage: npm run evidence:verify -- <record.json> [--jwks <file-or-url>] [--json]\n");
  });
});

describe("npm run evidence:verify (as a process)", () => {
  const tsx = join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");
  const script = join(REPO_ROOT, "scripts/verify-evidence.ts");
  const spawn = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [tsx, script, ...args], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, NODE_ENV: "development", ...env } });

  it("exits 0 with PASS for an intact record", () => {
    const result = spawn([file("record.json"), "--jwks", file("jwks.json")]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\nPASS {2}The record is unchanged since it was signed/);
  });

  it("exits 1 with FAIL for a tampered record", () => {
    const result = spawn([file("tampered.json"), "--jwks", file("jwks.json")]);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/\nFAIL {2}record_hash_mismatch: /);
    expect(result.stdout).not.toMatch(/^PASS/m);
  });

  it("exits 2 when the file is missing, and when no key set is available", () => {
    const missing = spawn([file("missing.json"), "--jwks", file("jwks.json")]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/evidence:verify could not run: Signed record file not found/);

    // An empty data directory and no configured key: the command must say so and must not create a key.
    const dataDir = join(dir, "no-data-here");
    const noKeys = spawn([file("record.json")], { ECCA_DATA_DIR: dataDir, EVIDENCE_SIGNING_PRIVATE_KEY: "" });
    expect(noKeys.status).toBe(2);
    expect(noKeys.stderr).toMatch(/No key set given and this deployment has no evidence signing key\. Pass --jwks <file-or-url>\./);
    expect(spawnSync("ls", [dataDir]).status).not.toBe(0);
  });
});
