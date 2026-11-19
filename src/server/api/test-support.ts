/**
 * Test-only helpers for the API module: a tiny router that dispatches a request to the real route handler file under
 * src/app/api/v1 (found by scanning the directory, as Next does), and a world of SYNTHETIC organizations with keys.
 * Every organization, person, booking, amount and URL here is synthetic. Not imported by application code.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Mode } from "@/db/schema";
import { putObject } from "@/server/storage";
import { buildSignedEvidence } from "@/engine/evidence/platform";
import { syntheticCategoricalEligibleInput } from "@/engine/evidence/synthetic-fixtures";
import { setWebhookResolverForTests } from "@/server/webhooks";
import { createApiKey } from "./keys";
import { API_BASE_PATH } from "./policy";

export const ROUTES_DIR = fileURLToPath(new URL("../../app/api/v1/", import.meta.url));
export const TEST_ORIGIN = "http://localhost:3000";

export interface DiscoveredRoute {
  file: string;
  /** OpenAPI-style path under /api/v1, e.g. "/verifications/{id}/cancel". */
  path: string;
  regex: RegExp;
  paramNames: string[];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

/** Every route.ts under src/app/api/v1, static segments before dynamic ones (Next's precedence). */
export function discoverRoutes(): DiscoveredRoute[] {
  return walk(ROUTES_DIR)
    .map((file) => {
      const segments = relative(ROUTES_DIR, file).split(sep).slice(0, -1);
      const paramNames: string[] = [];
      const path = `/${segments.map((s) => (s.startsWith("[") ? `{${s.slice(1, -1)}}` : s)).join("/")}`;
      const regex = new RegExp(
        `^/${segments
          .map((s) => {
            if (s.startsWith("[")) {
              paramNames.push(s.slice(1, -1));
              return "([^/]+)";
            }
            return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          })
          .join("/")}$`,
      );
      return { file, path: path === "/" ? "/" : path, regex, paramNames };
    })
    .sort((a, b) => (a.paramNames.length - b.paramNames.length) || a.path.localeCompare(b.path));
}

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;

export interface ApiCallOptions {
  /** Full secret key; null sends no Authorization header. */
  key?: string | null;
  authorization?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

/** Dispatches to the route handler that Next would pick for `path` (relative to /api/v1, query string allowed). */
export async function callApi(method: string, path: string, opts: ApiCallOptions = {}): Promise<Response> {
  const [pathname] = path.split("?");
  const route = discoverRoutes().find((r) => r.regex.test(pathname));
  if (!route) return new Response(null, { status: 404 });
  const match = route.regex.exec(pathname)!;
  const params = Object.fromEntries(route.paramNames.map((n, i) => [n, decodeURIComponent(match[i + 1])]));
  const mod = (await import(/* @vite-ignore */ pathToFileURL(route.file).href)) as Record<string, Handler | undefined>;
  const handler = mod[method.toUpperCase()];
  if (!handler) return new Response(null, { status: 405 });
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.authorization !== undefined) headers.authorization = opts.authorization;
  else if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  let body: string | undefined;
  if (opts.rawBody !== undefined) body = opts.rawBody;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] ??= "application/json";
  }
  const request = new Request(`${TEST_ORIGIN}${API_BASE_PATH}${path}`, { method: method.toUpperCase(), headers, ...(body !== undefined ? { body } : {}) });
  return handler(request, { params: Promise.resolve(params) });
}

export async function callJson<T = Record<string, unknown>>(method: string, path: string, opts: ApiCallOptions = {}): Promise<{ status: number; body: T; headers: Headers }> {
  const res = await callApi(method, path, opts);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
}

/** A system-created key for tests. */
export async function makeKey(orgId: string, mode: Mode, name = "synthetic test key"): Promise<string> {
  return (await createApiKey(orgId, { name, mode }, { type: "system", reason: "api test fixture" })).secret;
}

/** Resolves every webhook host to a public documentation address, so endpoints can be registered offline. */
export function allowWebhookHosts(): void {
  setWebhookResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
}

/**
 * Marks a verification decided (eligible, direct) and attaches a real signed evidence record (synthetic fixture) and a
 * placeholder PDF, standing in for the decide and evidence jobs (tested in src/server/verifications).
 */
export async function attachSyntheticEvidence(orgId: string, verificationId: string): Promise<{ pdfId: string; jsonId: string }> {
  const signed = buildSignedEvidence(syntheticCategoricalEligibleInput());
  const json = await putObject({ bytes: Buffer.from(JSON.stringify(signed, null, 2)), contentType: "application/json", purpose: "evidence_json", orgId, filename: `evidence-${verificationId}.json` });
  const pdf = await putObject({ bytes: Buffer.from("%PDF-1.7\n% SYNTHETIC evidence pack placeholder\n%%EOF\n"), contentType: "application/pdf", purpose: "evidence_pdf", orgId, filename: `evidence-${verificationId}.pdf` });
  const db = await getDb();
  await db
    .update(schema.verifications)
    .set({ status: "eligible", stage: "decided", method: "categorical", decidedAt: new Date("2026-11-18T16:20:00.000Z"), decidedBy: "engine", evidencePdfObjectId: pdf.id, evidenceJsonObjectId: json.id })
    .where(eq(schema.verifications.id, verificationId));
  return { pdfId: pdf.id, jsonId: json.id };
}
