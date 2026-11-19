import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { GET as openApiRoute } from "@/app/api/v1/openapi.json/route";
import { EXAMPLE_ERROR, EXAMPLE_EVIDENCE_NOT_READY, EXAMPLE_PENDING_VERIFICATION } from "./examples";
import { OPENAPI_PUBLIC_FILE, OPERATION_EXAMPLES, REQUEST_EXAMPLES, openApiDocument } from "./openapi";
import { OPERATIONS, OPERATION_IDS, type OperationDefinition } from "./operations";
import { errorSchema, verificationSchema } from "./schemas";
import { discoverRoutes } from "./test-support";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

type Doc = { openapi: string; paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, unknown>; parameters: Record<string, unknown> } };

describe("OpenAPI document", () => {
  const doc = openApiDocument() as unknown as Doc;

  it("is committed as public/openapi/v1.json, byte for byte (UPDATE_OPENAPI=1 rewrites it)", () => {
    const file = join(REPO_ROOT, OPENAPI_PUBLIC_FILE);
    const expected = `${JSON.stringify(doc, null, 2)}\n`;
    if (process.env.UPDATE_OPENAPI === "1") {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, expected);
    }
    expect(existsSync(file), `${OPENAPI_PUBLIC_FILE} is missing: run UPDATE_OPENAPI=1 npx vitest run src/server/api/openapi.test.ts`).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(expected);
  });

  it("is OpenAPI 3.1 and deterministic", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(JSON.stringify(openApiDocument())).toBe(JSON.stringify(doc));
  });

  it("documents every route handler, and every documented operation has a route handler", async () => {
    const documented = new Set(OPERATION_IDS.map((id) => `${(OPERATIONS[id] as OperationDefinition).method} ${(OPERATIONS[id] as OperationDefinition).path}`));
    const implemented = new Set<string>();
    for (const route of discoverRoutes()) {
      const mod = (await import(/* @vite-ignore */ pathToFileURL(route.file).href)) as Record<string, unknown>;
      for (const method of HTTP_METHODS) if (typeof mod[method] === "function") implemented.add(`${method} ${route.path}`);
    }
    expect([...implemented].sort()).toEqual([...documented].sort());
    // The generated document has exactly those operations.
    const inDoc = new Set<string>();
    for (const [path, methods] of Object.entries(doc.paths)) for (const method of Object.keys(methods)) inDoc.add(`${method.toUpperCase()} ${path}`);
    expect([...inDoc].sort()).toEqual([...documented].sort());
  });

  it("resolves every $ref", () => {
    const refs = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        for (const [k, child] of Object.entries(v)) {
          if (k === "$ref" && typeof child === "string") refs.add(child);
          else walk(child);
        }
      }
    };
    walk(doc);
    expect(refs.size).toBeGreaterThan(10);
    for (const ref of refs) {
      const [, section, name] = /^#\/components\/(schemas|parameters)\/(.+)$/.exec(ref) ?? [];
      expect(section, ref).toBeTruthy();
      expect(doc.components[section as "schemas" | "parameters"][name], ref).toBeTruthy();
    }
  });

  it("has a response example for every JSON operation and a request example for every body, each valid against its schema", () => {
    for (const id of OPERATION_IDS) {
      const op = OPERATIONS[id] as OperationDefinition;
      if (op.response.kind === "json") {
        expect(OPERATION_EXAMPLES[id], `example for ${id}`).toBeDefined();
        const r = op.response.schema.safeParse(OPERATION_EXAMPLES[id]);
        expect(r.success, `${id}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
      }
      if (op.body) {
        expect(REQUEST_EXAMPLES[id], `request example for ${id}`).toBeDefined();
        const r = op.body.safeParse(REQUEST_EXAMPLES[id]);
        expect(r.success, `${id} request: ${JSON.stringify(r.error?.issues)}`).toBe(true);
      }
    }
    for (const e of [EXAMPLE_ERROR, EXAMPLE_EVIDENCE_NOT_READY]) expect(errorSchema.safeParse(e).success).toBe(true);
    expect(verificationSchema.safeParse(EXAMPLE_PENDING_VERIFICATION).success).toBe(true);
  });

  it("marks only the OpenAPI document itself as public, and every other operation with its organization types", () => {
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const op of Object.values(methods) as Array<{ security?: unknown[]; "x-org-types"?: string[] }>) {
        if (path === "/openapi.json") expect(op.security).toEqual([]);
        else expect(op["x-org-types"]?.length, path).toBeGreaterThan(0);
      }
    }
  });

  it("is served at GET /api/v1/openapi.json without a key", async () => {
    const res = openApiRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual(doc);
  });
});
