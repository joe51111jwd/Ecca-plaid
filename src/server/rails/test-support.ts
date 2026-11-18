import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { PlaidWebhookKey } from "./plaid-webhook";

/**
 * Test-only helpers for the rails module: a stand-in for Plaid's HTTP API and an ES256 signer for webhook
 * JWTs. Every key, id, name and amount here is SYNTHETIC; nothing talks to Plaid.
 */

export interface PlaidCall {
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

export type PlaidRoute = (body: Record<string, unknown>) => { status?: number; json: unknown } | Promise<{ status?: number; json: unknown }>;

/** A fetch that answers Plaid paths from `routes` and records every call. Unknown paths answer 404. */
export function fakePlaidFetch(routes: Record<string, PlaidRoute>): { fetch: typeof fetch; calls: PlaidCall[] } {
  const calls: PlaidCall[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ path: url.pathname, body, headers });
    const route = routes[url.pathname];
    if (!route) return new Response(JSON.stringify({ error_type: "INVALID_REQUEST", error_code: "NOT_FOUND", error_message: "no route" }), { status: 404 });
    const out = await route(body);
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { fetch: impl as typeof fetch, calls };
}

export interface WebhookSigner {
  key: PlaidWebhookKey;
  privateKey: KeyObject;
  kid: string;
}

export function makeWebhookSigner(kid = "synthetic-kid-1", createdAtSeconds = 1_700_000_000): WebhookSigner {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  return { key: { alg: "ES256", crv: "P-256", kid, kty: "EC", use: "sig", x: jwk.x, y: jwk.y, created_at: createdAtSeconds, expired_at: null }, privateKey, kid };
}

export function signJwt(privateKey: KeyObject, header: Record<string, unknown>, payload: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const s = sign("sha256", Buffer.from(`${h}.${p}`), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${h}.${p}.${s}`;
}

/** A Plaid /credit/payroll_income/get body in the documented shape (fact 57). */
export function payrollIncomeBody(year: number, opts: { status?: string; w2Wages?: string; stubYtd?: number | null; stubDate?: string; error?: unknown; noRecords?: boolean } = {}): Record<string, unknown> {
  return {
    request_id: "synthetic-req",
    error: opts.error ?? null,
    items: [
      {
        item_id: "item_synthetic",
        institution_name: "Synthetic Payroll Inc.",
        status: { processing_status: opts.status ?? "PROCESSING_COMPLETE" },
        payroll_income: opts.noRecords
          ? [{ account_id: null, w2s: [], pay_stubs: [], form1099s: [] }]
          : [
              {
                account_id: null,
                w2s: [
                  {
                    document_id: "doc_w2_synthetic",
                    tax_year: String(year),
                    wages_tips_other_comp: opts.w2Wages ?? "52000.00",
                    social_security_wages: "54000.00",
                    medicare_wages_and_tips: "54000.00",
                    employer_id_number: "12-3456789",
                    employer: { name: "Synthetic Widgets LLC" },
                  },
                ],
                pay_stubs: [
                  {
                    document_id: "doc_stub_synthetic",
                    earnings: { total: { current_amount: 2076.92, ytd_amount: opts.stubYtd === undefined ? 54000 : opts.stubYtd } },
                    net_pay: { current_amount: 1500, ytd_amount: 39000 },
                    pay_period_details: { pay_date: opts.stubDate ?? `${year}-12-26`, start_date: `${year}-12-08`, end_date: `${year}-12-21`, gross_earnings: 2076.92, pay_frequency: "BIWEEKLY" },
                    employer: { name: "Synthetic Widgets LLC" },
                    employee: { name: "Alex Synthetic", taxpayer_id: { id_mask: "1234" } },
                  },
                ],
                form1099s: [],
              },
            ],
      },
    ],
  };
}
