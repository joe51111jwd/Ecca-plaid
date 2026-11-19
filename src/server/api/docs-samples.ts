/**
 * Every code sample shown on /docs, in one place. The docs pages render these strings; docs-samples.test.ts executes
 * each one against the real route handlers (HTTP samples), runs the Node webhook verifier against the platform's own
 * signer, and runs the evidence CLI command on a downloaded record. A sample that stops working fails the tests, so
 * the docs cannot drift from the API.
 *
 * Placeholders in paths and bodies are written `{name}` and filled in by the reader (or the test) — e.g.
 * `{verification_id}` is the `id` returned by the create call.
 */
import { WEBHOOK_HEADER } from "@/server/webhooks";
import { API_BASE_PATH } from "./policy";

export type SampleKey = "sgo" | "business";

export interface HttpSample {
  id: string;
  title: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path under /api/v1, possibly with `{placeholders}` and a query string. */
  path: string;
  /** Which kind of secret key the sample uses. */
  key: SampleKey;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** Save the response to this file (curl -o) instead of printing it. */
  output?: string;
  /** The status the sample produces in the scenario the docs describe. */
  expectStatus: number;
}

/** Host shown in samples. Readers replace it with their deployment's address. */
export const SAMPLE_HOST = "https://YOUR-PASSPORT-HOST";
/** Environment variable the samples read the secret key from. */
export const SAMPLE_KEY_VAR = "$PASSPORT_API_KEY";

export const HTTP_SAMPLES = {
  me: { id: "me", title: "Check your key", method: "GET", path: "/me", key: "sgo", expectStatus: 200 },
  createVerification: {
    id: "createVerification",
    title: "Create a verification",
    method: "POST",
    path: "/verifications",
    key: "sgo",
    headers: { "Idempotency-Key": "app-1042-create" },
    body: { external_ref: "APP-1042", student: { first_name: "Riley", last_name: "Synthetic" }, return_url: "https://apply.example.org/done", metadata: { campus: "north" } },
    expectStatus: 201,
  },
  getVerification: { id: "getVerification", title: "Read it back", method: "GET", path: "/verifications/{verification_id}", key: "sgo", expectStatus: 200 },
  listVerifications: { id: "listVerifications", title: "List pending verifications", method: "GET", path: "/verifications?status=pending&limit=10", key: "sgo", expectStatus: 200 },
  evidenceBeforeDecision: {
    id: "evidenceBeforeDecision",
    title: "Download the evidence pack",
    method: "GET",
    path: "/verifications/{verification_id}/evidence.pdf",
    key: "sgo",
    output: "evidence.pdf",
    expectStatus: 409,
  },
  evidenceJson: {
    id: "evidenceJson",
    title: "Download the signed evidence record",
    method: "GET",
    path: "/verifications/{verification_id}/evidence.json",
    key: "sgo",
    output: "evidence.json",
    expectStatus: 200,
  },
  evidencePdf: {
    id: "evidencePdf",
    title: "Download the evidence pack (PDF)",
    method: "GET",
    path: "/verifications/{verification_id}/evidence.pdf",
    key: "sgo",
    output: "evidence.pdf",
    expectStatus: 200,
  },
  createWebhookEndpoint: {
    id: "createWebhookEndpoint",
    title: "Register a webhook endpoint",
    method: "POST",
    path: "/webhook_endpoints",
    key: "sgo",
    body: { url: "https://hooks.example.org/passport", event_types: ["verification.decided", "verification.needs_review"] },
    expectStatus: 201,
  },
  listEvents: { id: "listEvents", title: "List recent events", method: "GET", path: "/events?limit=5", key: "sgo", expectStatus: 200 },
  exportCsv: {
    id: "exportCsv",
    title: "Export in another system's column layout",
    method: "GET",
    path: "/verifications/export.csv?columns=external_ref:ApplicantID,status:Result,decided_at:DecisionDate,threshold_source:LimitSource",
    key: "sgo",
    output: "verifications.csv",
    expectStatus: 200,
  },
  cancelVerification: { id: "cancelVerification", title: "Cancel a verification", method: "POST", path: "/verifications/{verification_id}/cancel", key: "sgo", expectStatus: 200 },
  createHandoff: {
    id: "createHandoff",
    title: "Create a handoff from your server",
    method: "POST",
    path: "/handoffs",
    key: "business",
    headers: { "Idempotency-Key": "booking-BK-2027-0042" },
    body: {
      booking_ref: "BK-2027-0042",
      booking_description: "Day camp, week 1",
      booking_amount_cents: 45000,
      return_url: "https://camp.synthetic-example.org/booking/BK-2027-0042",
      channel: "redirect",
    },
    expectStatus: 201,
  },
  getHandoff: { id: "getHandoff", title: "Check the handoff", method: "GET", path: "/handoffs/{handoff_id}", key: "business", expectStatus: 200 },
  extendHold: { id: "extendHold", title: "Hold the spot longer", method: "POST", path: "/handoffs/{handoff_id}/extend_hold", key: "business", body: { hours: 48 }, expectStatus: 200 },
  completeBeforeAward: {
    id: "completeBeforeAward",
    title: "Complete the booking once awarded",
    method: "POST",
    path: "/handoffs/{handoff_id}/complete",
    key: "business",
    body: { booking_amount_cents: 45000 },
    expectStatus: 409,
  },
  cancelHandoff: { id: "cancelHandoff", title: "Cancel a handoff", method: "POST", path: "/handoffs/{handoff_id}/cancel", key: "business", body: { reason: "Family chose another session" }, expectStatus: 200 },
} as const satisfies Record<string, HttpSample>;

export type HttpSampleId = keyof typeof HTTP_SAMPLES;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The curl command for a sample, exactly as the docs print it. */
export function renderCurl(sample: HttpSample, opts: { host?: string; keyVar?: string } = {}): string {
  const host = opts.host ?? SAMPLE_HOST;
  const lines: string[] = [];
  const url = `${host}${API_BASE_PATH}${sample.path}`;
  lines.push(`curl${sample.method === "GET" ? "" : ` -X ${sample.method}`} ${url.includes("?") || url.includes("{") ? `"${url}"` : url}`);
  lines.push(`  -H "Authorization: Bearer ${opts.keyVar ?? SAMPLE_KEY_VAR}"`);
  for (const [name, value] of Object.entries(sample.headers ?? {})) lines.push(`  -H "${name}: ${value}"`);
  if (sample.body) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d ${shellQuote(JSON.stringify(sample.body, null, 2))}`);
  }
  if (sample.output) lines.push(`  -o ${sample.output}`);
  return lines.join(" \\\n");
}

export interface ParsedCurl {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  output: string | null;
}

/**
 * Parses the subset of curl syntax renderCurl produces. The docs test parses every printed command and executes what
 * it parsed, so the printed text itself (not just the data it was made from) is what gets tested.
 */
export function parseCurl(command: string): ParsedCurl {
  const tokens: string[] = [];
  const src = command.replace(/\\\n/g, " ");
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\n") {
      i++;
      continue;
    }
    let token = "";
    while (i < src.length && src[i] !== " " && src[i] !== "\n") {
      if (src[i] === "'") {
        const end = src.indexOf("'", i + 1);
        if (end < 0) throw new Error("Unterminated single quote");
        token += src.slice(i + 1, end);
        i = end + 1;
        // A shell-quoted single quote is written '\'' : close, escaped quote, reopen.
        if (src.startsWith("\\''", i)) {
          token += "'";
          i += 3;
          const close = src.indexOf("'", i);
          token += src.slice(i, close);
          i = close + 1;
        }
      } else if (src[i] === '"') {
        const end = src.indexOf('"', i + 1);
        if (end < 0) throw new Error("Unterminated double quote");
        token += src.slice(i + 1, end);
        i = end + 1;
      } else {
        token += src[i];
        i++;
      }
    }
    tokens.push(token);
  }
  if (tokens[0] !== "curl") throw new Error("Not a curl command");
  const out: ParsedCurl = { method: "GET", url: "", headers: {}, body: null, output: null };
  for (let t = 1; t < tokens.length; t++) {
    const tok = tokens[t];
    if (tok === "-X") out.method = tokens[++t];
    else if (tok === "-H") {
      const h = tokens[++t];
      const colon = h.indexOf(":");
      out.headers[h.slice(0, colon).trim()] = h.slice(colon + 1).trim();
    } else if (tok === "-d") out.body = tokens[++t];
    else if (tok === "-o") out.output = tokens[++t];
    else out.url = tok;
  }
  return out;
}

/* ---------------------------------------------------------------------------------------- webhooks */

/**
 * Copy-paste webhook verifier for Node 18+ (no dependencies). It implements exactly what verifyWebhookSignature in
 * src/server/webhooks/signing.ts checks; the docs test compares the two on valid, tampered, stale, future, rotated
 * and malformed inputs.
 */
export const NODE_WEBHOOK_VERIFIER = `import crypto from "node:crypto";

/**
 * Returns true when a request carries a current, correctly signed Passport webhook.
 *   secret   your endpoint's signing secret ("whsec_...")
 *   headers  the request headers (a Fetch Headers object or Node's req.headers)
 *   rawBody  the body exactly as received (string or Buffer) — never re-serialized JSON
 */
export function verifyPassportWebhook(secret, headers, rawBody, { toleranceSeconds = 300, now = Date.now() } = {}) {
  const get = (name) => {
    if (typeof headers.get === "function") return headers.get(name);
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === name) return Array.isArray(value) ? value.join(" ") : value ?? null;
    }
    return null;
  };
  const id = get("${WEBHOOK_HEADER.id}");
  const timestamp = get("${WEBHOOK_HEADER.timestamp}");
  const signatures = get("${WEBHOOK_HEADER.signature}");
  if (!id || !timestamp || !signatures) return false;
  if (!/^\\d{1,12}$/.test(timestamp)) return false;

  // Reject requests older or newer than the tolerance: a captured request cannot be replayed later.
  const seconds = Number(timestamp);
  const nowSeconds = Math.floor(now / 1000);
  if (seconds < nowSeconds - toleranceSeconds || seconds > nowSeconds + toleranceSeconds) return false;

  const encoded = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const key = Buffer.from(encoded, "base64");
  if (key.length === 0) return false;

  const expected = crypto.createHmac("sha256", key).update(\`\${id}.\${seconds}.\`).update(rawBody).digest();
  // During a secret rotation the header carries one signature per secret: accept any match.
  for (const candidate of signatures.split(/\\s+/)) {
    const comma = candidate.indexOf(",");
    if (comma < 0 || candidate.slice(0, comma) !== "v1") continue;
    const given = Buffer.from(candidate.slice(comma + 1), "base64");
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return true;
  }
  return false;
}
`;

/** How to use the verifier in a Next.js route handler (shown under it on /docs/webhooks). */
export const NODE_WEBHOOK_HANDLER = `// app/passport-webhook/route.js
import { verifyPassportWebhook } from "./verify-passport-webhook.js";

export async function POST(request) {
  const rawBody = await request.text();
  if (!verifyPassportWebhook(process.env.PASSPORT_WEBHOOK_SECRET, request.headers, rawBody)) {
    return new Response("invalid signature", { status: 401 });
  }
  const event = JSON.parse(rawBody);
  // webhook-id is stable across retries: skip events you have already processed.
  if (await alreadyProcessed(request.headers.get("webhook-id"))) return new Response("ok");
  if (event.type === "verification.decided") await updateApplicant(event.data.external_ref, event.data.status);
  return new Response("ok");
}
`;

/* ---------------------------------------------------------------------------------------- evidence */

/** Checking a downloaded evidence record against the published keys. `{host}` is your deployment. */
export const EVIDENCE_VERIFY_COMMAND = "npm run evidence:verify -- evidence.json --jwks {host}/.well-known/jwks.json";

/** Offline variant: a saved copy of the key set. */
export const EVIDENCE_VERIFY_OFFLINE_COMMAND = `curl -o jwks.json {host}/.well-known/jwks.json
npm run evidence:verify -- evidence.json --jwks jwks.json`;

/** The argv the evidence CLI receives for a command line (`npm run evidence:verify -- <args>`). */
export function evidenceCliArgs(command: string, host: string): string[] {
  const line = command.replace(/\{host\}/g, host).split("\n").find((l) => l.startsWith("npm run evidence:verify -- "));
  if (!line) throw new Error("Not an evidence:verify command");
  return line.slice("npm run evidence:verify -- ".length).trim().split(/\s+/);
}

/* ---------------------------------------------------------------------------------------- handoffs */

/** Server-side create + redirect (what a booking checkout does when the family picks "pay with a scholarship"). */
export const HANDOFF_REDIRECT_SNIPPET = `// On your server, when the family chooses to apply for a scholarship at checkout:
const res = await fetch("${SAMPLE_HOST}${API_BASE_PATH}/handoffs", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.PASSPORT_API_KEY}\`,
    "Content-Type": "application/json",
    "Idempotency-Key": \`booking-\${booking.id}\`,
  },
  body: JSON.stringify({
    booking_ref: booking.id,
    booking_description: booking.title,
    booking_amount_cents: booking.totalCents,
    return_url: \`https://camp.example.org/booking/\${booking.id}\`,
    channel: "redirect",
  }),
});
if (!res.ok) throw new Error(\`Passport: \${res.status}\`);
const handoff = await res.json();
await saveHandoffId(booking.id, handoff.id);   // keep the id, never the url
return redirect(handoff.url);                   // send the family to the hosted page
`;

/** The embed snippet for a booking page. Contract: HANDOFF_EMBED_CONTRACT. */
export const HANDOFF_EMBED_SNIPPET = `<script
  src="${SAMPLE_HOST}/embed/handoff.js"
  data-publishable-key="pk_test_..."
  data-booking-ref="BK-2027-0042"
  data-booking-description="Day camp, week 1"
  data-booking-amount-cents="45000"
  data-return-url="https://camp.example.org/booking/BK-2027-0042"
  async></script>
<script>
  document.addEventListener("passport:handoff", (event) => {
    // A hint for your page only: confirm the status server-side (webhook or GET /api/v1/handoffs/{id}).
    if (event.detail.type === "handoff.created") saveHandoffId(event.detail.handoff_id);
  });
</script>`;
