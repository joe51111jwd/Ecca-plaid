import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as jwksRoute } from "@/app/.well-known/jwks.json/route";
import { EMBED_MESSAGE_SOURCE } from "@/components/layout/embed-frame";
import { setTestNow } from "@/lib/clock";
import { makeBusiness, makeSgo, partner } from "@/server/handoffs/test-support";
import { buildSignedRequest, checkWebhookSignature, setWebhookResolverForTests, verifyWebhookSignature } from "@/server/webhooks";
import { generateWebhookSecret } from "@/server/webhooks/signing";
import { EXIT, runVerifyEvidence } from "../../../scripts/verify-evidence";
import { useTestDb } from "../../../tests/helpers/db";
import {
  EVIDENCE_VERIFY_COMMAND,
  EVIDENCE_VERIFY_OFFLINE_COMMAND,
  evidenceCliArgs,
  HANDOFF_EMBED_SNIPPET,
  HANDOFF_REDIRECT_SNIPPET,
  HTTP_SAMPLES,
  NODE_WEBHOOK_HANDLER,
  NODE_WEBHOOK_VERIFIER,
  parseCurl,
  renderCurl,
  SAMPLE_HOST,
  SAMPLE_KEY_VAR,
  type HttpSample,
  type HttpSampleId,
} from "./docs-samples";
import { HANDOFF_EMBED_CONTRACT } from "./handoff-embed-contract";
import { OPERATIONS, OPERATION_IDS, type OperationDefinition } from "./operations";
import { API_BASE_PATH } from "./policy";
import { allowWebhookHosts, attachSyntheticEvidence, callApi, makeKey, TEST_ORIGIN } from "./test-support";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "passport-docs-samples-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function operationFor(method: string, path: string): OperationDefinition | undefined {
  const pathname = path.split("?")[0];
  return OPERATION_IDS.map((id) => OPERATIONS[id] as OperationDefinition).find(
    (op) => op.method === method && new RegExp(`^${op.path.replace(/[.]/g, "\\.").replace("{id}", "[^/]+")}$`).test(pathname),
  );
}

describe("curl rendering", () => {
  it("prints commands that parse back to exactly the sample's request", () => {
    for (const sample of Object.values(HTTP_SAMPLES) as HttpSample[]) {
      const parsed = parseCurl(renderCurl(sample));
      expect(parsed.method, sample.id).toBe(sample.method);
      expect(parsed.url).toBe(`${SAMPLE_HOST}${API_BASE_PATH}${sample.path}`);
      expect(parsed.headers.Authorization).toBe(`Bearer ${SAMPLE_KEY_VAR}`);
      for (const [k, v] of Object.entries(sample.headers ?? {})) expect(parsed.headers[k]).toBe(v);
      expect(parsed.body === null ? null : JSON.parse(parsed.body)).toEqual(sample.body ?? null);
      expect(parsed.output).toBe(sample.output ?? null);
      expect(operationFor(sample.method, sample.path), `${sample.id} names a documented operation`).toBeDefined();
    }
  });

  it("round-trips single quotes in bodies", () => {
    const sample: HttpSample = { id: "q", title: "q", method: "POST", path: "/x", key: "sgo", body: { reason: "it's fine" }, expectStatus: 200 };
    expect(JSON.parse(parseCurl(renderCurl(sample)).body!)).toEqual({ reason: "it's fine" });
  });
});

describe("HTTP samples run against the route handlers", () => {
  useTestDb({ truncate: false });
  const keys: Record<"sgo" | "business", string> = { sgo: "", business: "" };
  const vars: Record<string, string> = {};
  let sgoOrg = "";

  beforeAll(async () => {
    setTestNow("2026-11-18T16:00:00.000Z");
    allowWebhookHosts();
    sgoOrg = await makeSgo("Synthetic Docs Fund");
    const business = await makeBusiness();
    await partner(business.orgId, sgoOrg);
    keys.sgo = await makeKey(sgoOrg, "test");
    keys.business = await makeKey(business.orgId, "test");
  });
  afterAll(() => {
    setTestNow(null);
    setWebhookResolverForTests(null);
  });

  /** Renders the sample as the docs print it (with the real key and host), parses the printed text and executes it. */
  async function run(id: HttpSampleId): Promise<Response> {
    const sample = HTTP_SAMPLES[id] as HttpSample;
    let command = renderCurl(sample, { host: TEST_ORIGIN, keyVar: keys[sample.key] });
    for (const [name, value] of Object.entries(vars)) command = command.replaceAll(`{${name}}`, value);
    expect(command, `unfilled placeholder in ${id}`).not.toMatch(/\{[a-z_]+\}/);
    const parsed = parseCurl(command);
    const path = parsed.url.slice(`${TEST_ORIGIN}${API_BASE_PATH}`.length);
    const headers = { ...parsed.headers };
    const authorization = headers.Authorization;
    delete headers.Authorization;
    const res = await callApi(parsed.method, path, { authorization, headers, ...(parsed.body !== null ? { rawBody: parsed.body } : {}) });
    expect(res.status, `${id}: ${await res.clone().text()}`).toBe(sample.expectStatus);
    const op = operationFor(parsed.method, path)!;
    if (res.status < 300 && op.response.kind === "json") {
      const r = op.response.schema.safeParse(await res.clone().json());
      expect(r.success, `${id} response matches the documented schema`).toBe(true);
    }
    return res;
  }

  it("runs the Quickstart: key check, create, read, list, 409 before a decision, webhook, events, export", async () => {
    await run("me");
    const created = (await (await run("createVerification")).json()) as { id: string; family_url: string };
    vars.verification_id = created.id;
    // Retrying the documented create (same Idempotency-Key) replays instead of creating a second one.
    const replay = await run("createVerification");
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    await run("getVerification");
    const list = (await (await run("listVerifications")).json()) as { data: Array<{ id: string }> };
    expect(list.data.map((v) => v.id)).toEqual([created.id]);
    const early = (await (await run("evidenceBeforeDecision")).json()) as { error: { details: { reason: string } } };
    expect(early.error.details.reason).toBe("evidence_not_ready");
    const endpoint = (await (await run("createWebhookEndpoint")).json()) as { secret: string };
    expect(endpoint.secret).toMatch(/^whsec_/);
    await run("listEvents");
    const csv = await (await run("exportCsv")).text();
    expect(csv.split("\r\n")[0]).toBe("ApplicantID,Result,DecisionDate,LimitSource");
    expect(csv.split("\r\n")[1]).toBe("APP-1042,pending,,");
  });

  it("downloads the signed evidence record and verifies it with both documented CLI commands", async () => {
    await attachSyntheticEvidence(sgoOrg, vars.verification_id);
    const res = await run("evidenceJson");
    writeFileSync(join(dir, "evidence.json"), Buffer.from(await res.arrayBuffer()));

    const out: string[] = [];
    const io = {
      cwd: dir,
      stdout: (t: string) => out.push(t),
      stderr: (t: string) => out.push(t),
      fetch: async (url: string) => {
        expect(url).toBe(`${TEST_ORIGIN}/.well-known/jwks.json`);
        const r = jwksRoute(new Request(url));
        return { ok: r.ok, status: r.status, text: () => r.text() };
      },
    };
    expect(await runVerifyEvidence(evidenceCliArgs(EVIDENCE_VERIFY_COMMAND, TEST_ORIGIN), io), out.join("\n")).toBe(EXIT.pass);

    // Offline: the first line saves the key set (curl -o jwks.json), the second checks against the file.
    const curlLine = EVIDENCE_VERIFY_OFFLINE_COMMAND.split("\n")[0].replace("{host}", TEST_ORIGIN);
    const parsed = parseCurl(curlLine);
    writeFileSync(join(dir, parsed.output!), await jwksRoute(new Request(parsed.url)).text());
    expect(await runVerifyEvidence(evidenceCliArgs(EVIDENCE_VERIFY_OFFLINE_COMMAND, TEST_ORIGIN), { ...io, fetch: async () => Promise.reject(new Error("offline")) })).toBe(EXIT.pass);
  });

  it("cancels with the documented call", async () => {
    const fresh = (await (await callApi("POST", "/verifications", { key: keys.sgo, body: {} })).json()) as { id: string };
    vars.verification_id = fresh.id;
    await run("cancelVerification");
  });

  it("runs the handoff samples: create, read, extend, complete refused before an award, cancel", async () => {
    const created = (await (await run("createHandoff")).json()) as { id: string; url: string };
    vars.handoff_id = created.id;
    await run("getHandoff");
    await run("extendHold");
    await run("completeBeforeAward");
    await run("cancelHandoff");
  });

  it("runs the server-side create + redirect snippet against the API", async () => {
    let redirectedTo = "";
    let saved: [string, string] | null = null;
    const fetchToRoutes = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      expect(url.startsWith(`${SAMPLE_HOST}${API_BASE_PATH}`)).toBe(true);
      const { Authorization, ...headers } = init.headers;
      return callApi(init.method, url.slice(`${SAMPLE_HOST}${API_BASE_PATH}`.length), { authorization: Authorization, headers, rawBody: init.body });
    };
    const booking = { id: "BK-SNIPPET-1", title: "Synthetic camp week", totalCents: 45000 };
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;
    const snippet = HANDOFF_REDIRECT_SNIPPET.replace("https://camp.example.org", "https://camp.synthetic-example.org");
    const fn = new AsyncFunction("fetch", "booking", "saveHandoffId", "redirect", "process", snippet);
    await fn(
      fetchToRoutes,
      booking,
      async (bookingId: string, handoffId: string) => {
        saved = [bookingId, handoffId];
      },
      (url: string) => {
        redirectedTo = url;
        return url;
      },
      { env: { PASSPORT_API_KEY: keys.business } },
    );
    expect(saved).not.toBeNull();
    expect(saved![0]).toBe("BK-SNIPPET-1");
    expect(redirectedTo).toMatch(/\/h\/[A-Za-z0-9_-]{43}$/);
  });
});

describe("Node webhook verifier sample", () => {
  type Verifier = (secret: string, headers: unknown, rawBody: string | Buffer, opts?: { toleranceSeconds?: number; now?: number }) => boolean;
  let verify: Verifier;

  beforeAll(async () => {
    const file = join(dir, "verify-passport-webhook.mjs");
    writeFileSync(file, NODE_WEBHOOK_VERIFIER);
    verify = ((await import(/* @vite-ignore */ pathToFileURL(file).href)) as { verifyPassportWebhook: Verifier }).verifyPassportWebhook;
  });

  it("agrees with verifyWebhookSignature on valid, tampered, stale, future, rotated and malformed requests", () => {
    const secret = generateWebhookSecret();
    const oldSecret = generateWebhookSecret();
    const nowMs = Date.UTC(2026, 10, 18, 16, 0, 0);
    const now = new Date(nowMs);
    const body = JSON.stringify({ id: "evt_SYNTHETIC", type: "verification.decided", data: { status: "eligible" } });
    const signed = (opts: { at?: number; secrets?: string[]; id?: string; body?: string } = {}) =>
      buildSignedRequest({ url: "https://hooks.example.org/x", id: opts.id ?? "evt_SYNTHETIC", timestamp: Math.floor((opts.at ?? nowMs) / 1000), body: opts.body ?? body, secrets: opts.secrets ?? [secret] });

    const cases: Array<{ name: string; secret: string; headers: Record<string, string | string[]> | Headers; body: string | Buffer; expected: boolean }> = [];
    const ok = signed();
    cases.push({ name: "valid", secret, headers: ok.headers, body, expected: true });
    cases.push({ name: "valid, Fetch Headers", secret, headers: new Headers(ok.headers), body, expected: true });
    cases.push({ name: "valid, Buffer body", secret, headers: ok.headers, body: Buffer.from(body), expected: true });
    cases.push({ name: "valid, upper-case header names", secret, headers: Object.fromEntries(Object.entries(ok.headers).map(([k, v]) => [k.toUpperCase(), v])), body, expected: true });
    cases.push({ name: "secret without prefix", secret: secret.slice("whsec_".length), headers: ok.headers, body, expected: true });
    cases.push({ name: "tampered body", secret, headers: ok.headers, body: body.replace("eligible", "ineligible"), expected: false });
    cases.push({ name: "wrong secret", secret: oldSecret, headers: ok.headers, body, expected: false });
    cases.push({ name: "stale (301 s)", secret, headers: signed({ at: nowMs - 301_000 }).headers, body, expected: false });
    cases.push({ name: "edge (300 s old)", secret, headers: signed({ at: nowMs - 300_000 }).headers, body, expected: true });
    cases.push({ name: "future (301 s)", secret, headers: signed({ at: nowMs + 301_000 }).headers, body, expected: false });
    cases.push({ name: "edge (300 s ahead)", secret, headers: signed({ at: nowMs + 300_000 }).headers, body, expected: true });
    const rotated = signed({ secrets: [secret, oldSecret] });
    cases.push({ name: "rotation, old secret", secret: oldSecret, headers: rotated.headers, body, expected: true });
    cases.push({ name: "rotation, new secret", secret, headers: rotated.headers, body, expected: true });
    const { "webhook-id": _id, ...noId } = ok.headers;
    void _id;
    cases.push({ name: "missing webhook-id", secret, headers: noId, body, expected: false });
    cases.push({ name: "non-numeric timestamp", secret, headers: { ...ok.headers, "webhook-timestamp": "17x" }, body, expected: false });
    cases.push({ name: "v2 signature only", secret, headers: { ...ok.headers, "webhook-signature": ok.headers["webhook-signature"].replace("v1,", "v2,") }, body, expected: false });
    cases.push({ name: "garbage signature list", secret, headers: { ...ok.headers, "webhook-signature": "v1 v1, ,v1" }, body, expected: false });
    cases.push({ name: "malformed secret", secret: "whsec_!!!", headers: ok.headers, body, expected: false });
    cases.push({ name: "array header values", secret, headers: { ...ok.headers, "webhook-signature": [ok.headers["webhook-signature"]] }, body, expected: true });
    cases.push({ name: "signature for another id", secret, headers: { ...signed({ id: "evt_OTHER" }).headers, "webhook-id": "evt_SYNTHETIC" }, body, expected: false });

    for (const c of cases) {
      const reference = verifyWebhookSignature({ secret: c.secret, headers: c.headers as Record<string, string>, body: c.body, now });
      expect(reference, `reference: ${c.name} (${JSON.stringify(checkWebhookSignature({ secret: c.secret, headers: c.headers as Record<string, string>, body: c.body, now }))})`).toBe(c.expected);
      expect(verify(c.secret, c.headers, c.body, { now: nowMs }), `sample: ${c.name}`).toBe(c.expected);
    }
  });

  it("runs the documented route handler: accepts a signed delivery once, refuses a bad signature", async () => {
    writeFileSync(join(dir, "verify-passport-webhook.js"), NODE_WEBHOOK_VERIFIER);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
    const handlerFile = join(dir, "route.js");
    writeFileSync(handlerFile, NODE_WEBHOOK_HANDLER);
    const secret = generateWebhookSecret();
    const processed = new Set<string>();
    const updates: Array<[string, string]> = [];
    const g = globalThis as Record<string, unknown>;
    g.alreadyProcessed = async (id: string) => {
      const seen = processed.has(id);
      processed.add(id);
      return seen;
    };
    g.updateApplicant = async (ref: string, status: string) => {
      updates.push([ref, status]);
    };
    process.env.PASSPORT_WEBHOOK_SECRET = secret;
    try {
      const { POST } = (await import(/* @vite-ignore */ pathToFileURL(handlerFile).href)) as { POST: (r: Request) => Promise<Response> };
      const body = JSON.stringify({ id: "evt_SYNTHETIC_H", type: "verification.decided", created_at: new Date().toISOString(), mode: "test", data: { external_ref: "APP-1042", status: "eligible" } });
      const signed = buildSignedRequest({ url: "https://hooks.example.org/x", id: "evt_SYNTHETIC_H", timestamp: new Date(), body, secrets: secret });
      const send = (headers: Record<string, string>) => POST(new Request("https://hooks.example.org/passport-webhook", { method: "POST", headers, body }));
      expect((await send(signed.headers)).status).toBe(200);
      expect((await send(signed.headers)).status).toBe(200);
      expect(updates).toEqual([["APP-1042", "eligible"]]);
      expect((await send({ ...signed.headers, "webhook-signature": "v1,AAAA" })).status).toBe(401);
    } finally {
      delete g.alreadyProcessed;
      delete g.updateApplicant;
      delete process.env.PASSPORT_WEBHOOK_SECRET;
    }
  });
});

describe("handoff embed snippet", () => {
  it("uses exactly the documented contract: script path, required attributes, the DOM event", () => {
    expect(HANDOFF_EMBED_CONTRACT.messageSource).toBe(EMBED_MESSAGE_SOURCE);
    expect(HANDOFF_EMBED_SNIPPET).toContain(`src="${SAMPLE_HOST}${HANDOFF_EMBED_CONTRACT.scriptPath}"`);
    const used = [...HANDOFF_EMBED_SNIPPET.matchAll(/\s(data-[a-z-]+)=/g)].map((m) => m[1]);
    const documented = HANDOFF_EMBED_CONTRACT.attributes.map((a) => a.name);
    for (const name of used) expect(documented, name).toContain(name);
    for (const a of HANDOFF_EMBED_CONTRACT.attributes.filter((x) => x.required)) expect(used).toContain(a.name);
    expect(HANDOFF_EMBED_SNIPPET).toContain(`"${HANDOFF_EMBED_CONTRACT.domEvent}"`);

    // The listener script is valid JavaScript and reacts to handoff.created as documented.
    const inline = /<script>\n([\s\S]*?)<\/script>/.exec(HANDOFF_EMBED_SNIPPET)![1];
    const listeners: Record<string, (e: { detail: Record<string, string> }) => void> = {};
    const saved: string[] = [];
    new Function("document", "saveHandoffId", inline)({ addEventListener: (type: string, fn: (e: { detail: Record<string, string> }) => void) => (listeners[type] = fn) }, (id: string) => saved.push(id));
    listeners[HANDOFF_EMBED_CONTRACT.domEvent]({ detail: { type: "handoff.created", handoff_id: "ho_SYNTHETIC" } });
    listeners[HANDOFF_EMBED_CONTRACT.domEvent]({ detail: { type: "handoff.status", handoff_id: "ho_SYNTHETIC", status: "held" } });
    expect(saved).toEqual(["ho_SYNTHETIC"]);
  });
});
