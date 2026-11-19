/**
 * The developer quickstart with a real key: an SGO creates a test key on /sgo/developers, registers a webhook
 * endpoint through the API, creates a verification, reads it back, cancels it, and the cancellation reaches a local
 * listener as a Standard Webhooks request whose signature verifies with the endpoint's secret.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { createTestKey, drainJobs, newSgo, tag } from "./helpers";

interface Received {
  headers: IncomingHttpHeaders;
  body: string;
}

function listen(): Promise<{ server: Server; port: number; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port, received })));
}

/** Standard Webhooks, symmetric: base64(HMAC-SHA256(base64decode(secret without "whsec_"), `${id}.${ts}.${body}`)). */
function signatureValid(secret: string, headers: IncomingHttpHeaders, body: string): boolean {
  const id = String(headers["webhook-id"] ?? "");
  const ts = String(headers["webhook-timestamp"] ?? "");
  const expected = createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64")).update(`${id}.${ts}.${body}`).digest();
  return String(headers["webhook-signature"] ?? "")
    .split(" ")
    .some((part) => {
      const [version, sig] = part.split(",");
      const given = Buffer.from(sig ?? "", "base64");
      return version === "v1" && given.length === expected.length && timingSafeEqual(given, expected);
    });
}

test("API quickstart: create → get → cancel → signed webhook delivered", async ({ page, playwright }) => {
  await newSgo(page, "API Scholarship Fund");
  const key = await createTestKey(page, `Quickstart ${tag()}`);
  const { server, port, received } = await listen();
  const api = await playwright.request.newContext({ baseURL: new URL(page.url()).origin, extraHTTPHeaders: { Authorization: `Bearer ${key}` } });
  try {
    // Without a key, nothing.
    const anonymous = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
    expect((await anonymous.get("/api/v1/verifications")).status()).toBe(401);
    await anonymous.dispose();

    const endpoint = await api.post("/api/v1/webhook_endpoints", { data: { url: `http://localhost:${port}/hook`, description: "e2e listener", event_types: ["verification.canceled"] } });
    expect(endpoint.status()).toBe(201);
    const { secret } = (await endpoint.json()) as { secret: string };
    expect(secret).toMatch(/^whsec_/);

    const ref = `API-${tag()}`;
    const created = await api.post("/api/v1/verifications", { data: { external_ref: ref, student: { first_name: "Riley", last_name: "Synthetic" } }, headers: { "Idempotency-Key": `e2e-${ref}` } });
    expect(created.status()).toBe(201);
    const v = (await created.json()) as { id: string; status: string; provisional: boolean; family_url: string; mode: string };
    expect(v).toMatchObject({ status: "pending", provisional: true, mode: "test" });
    expect(v.family_url).toMatch(/\/v\//);

    const read = await api.get(`/api/v1/verifications/${v.id}`);
    expect(read.ok()).toBeTruthy();
    const readBody = (await read.json()) as Record<string, unknown>;
    expect(readBody).toMatchObject({ id: v.id, external_ref: ref, status: "pending" });
    // The family link is a credential: returned once at creation, never in a read.
    expect(readBody.family_url).toBeUndefined();

    const listed = (await (await api.get(`/api/v1/verifications?external_ref=${ref}`)).json()) as { data: Array<{ id: string }> };
    expect(listed.data.map((x) => x.id)).toEqual([v.id]);

    const canceled = await api.post(`/api/v1/verifications/${v.id}/cancel`, { data: {} });
    expect(canceled.ok()).toBeTruthy();
    expect(((await canceled.json()) as { status: string }).status).toBe("canceled");

    await expect(async () => {
      await drainJobs(page.request);
      expect(received.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30_000 });
    const delivery = received[0]!;
    expect(signatureValid(secret, delivery.headers, delivery.body)).toBe(true);
    expect(signatureValid("whsec_" + Buffer.from("not-the-secret-not-the-secret-00").toString("base64"), delivery.headers, delivery.body)).toBe(false);
    const event = JSON.parse(delivery.body) as { type: string; data?: { id?: string; object?: { id?: string } } };
    expect(event.type).toBe("verification.canceled");
    expect(JSON.stringify(event)).toContain(v.id);

    // The delivery is logged on the dashboard.
    await page.goto("/sgo/developers");
    await expect(page.getByRole("table", { name: "Recent deliveries" }).getByText("verification.canceled").first()).toBeVisible();
  } finally {
    await api.dispose();
    server.close();
  }
});
