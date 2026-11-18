import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTestNow } from "@/lib/clock";
import { enqueue, getJob, getJobStats } from "@/server/jobs";
import { useTestDb } from "../../../../../../tests/helpers/db";
import { GET, POST } from "./route";

const ran: string[] = [];

// The route runs whatever the app registry holds; a fixed registry keeps this test about the route.
vi.mock("@/server/jobs/registry", () => ({
  allJobHandlers: () => ({
    "route.work": async (payload: Record<string, unknown>) => {
      ran.push(String(payload.n));
    },
    "route.chain": async (payload: Record<string, unknown>) => {
      const n = Number(payload.n);
      ran.push(`chain-${n}`);
      if (n < 24) await enqueue("route.chain", { n: n + 1 });
    },
  }),
  allRecurringJobs: () => [{ type: "route.work", everyMs: 3_600_000, payload: { n: "recurring" } }],
}));

const URL_BASE = "http://localhost/api/internal/jobs/run";
const SECRET = "synthetic-cron-secret-for-tests";

function request(method: "GET" | "POST", opts: { query?: string; authorization?: string } = {}): Request {
  return new Request(`${URL_BASE}${opts.query ?? ""}`, { method, headers: opts.authorization ? { authorization: opts.authorization } : {} });
}

describe("POST/GET /api/internal/jobs/run", () => {
  useTestDb();

  beforeEach(() => {
    ran.length = 0;
    setTestNow("2026-11-18T12:00:00.000Z");
    vi.stubEnv("CRON_SECRET", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setTestNow(null);
    vi.restoreAllMocks();
  });

  describe("outside production with no CRON_SECRET", () => {
    it("is open and runs one pass: recurring jobs scheduled, due jobs run, stats returned", async () => {
      await enqueue("route.work", { n: 1 });
      const res = await POST(request("POST"));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({
        ok: true,
        drain: false,
        scheduled: 1,
        requeued: 0,
        deadLettered: 0,
        purged: 0,
        ran: 2,
        succeeded: 2,
        failed: 0,
        rounds: 1,
        drained: true,
        queue: { due: 0, scheduled: 0, running: 0, dead: 0 },
      });
      expect(ran.sort()).toEqual(["1", "recurring"]);
    });

    it("GET behaves the same (Vercel Cron)", async () => {
      const { id } = await enqueue("route.work", { n: 2 });
      const res = await GET(request("GET"));
      expect(res.status).toBe(200);
      expect((await res.json()).ran).toBe(2);
      expect((await getJob(id)).status).toBe("succeeded");
    });

    it("runs a single bounded round by default and reports what is still due", async () => {
      await enqueue("route.chain", { n: 0 });
      const res = await POST(request("POST", { query: "?limit=5" }));
      const body = await res.json();
      // Round of 5: the recurring job plus the first four links of the chain; the fifth link is still due.
      expect(body).toMatchObject({ ok: true, drain: false, ran: 5, rounds: 1, drained: false });
      expect(body.queue.due).toBe(1);
    });

    it("drains with ?drain=1 until no due job remains", async () => {
      await enqueue("route.chain", { n: 0 });
      const res = await POST(request("POST", { query: "?drain=1&limit=4" }));
      const body = await res.json();
      // 25 chain links + 1 recurring job = 26 runs in rounds of 4.
      expect(body).toMatchObject({ ok: true, drain: true, ran: 26, succeeded: 26, failed: 0, rounds: 7, drained: true });
      expect(body.queue).toEqual({ due: 0, scheduled: 0, running: 0, dead: 0 });
      expect(ran.filter((r) => r.startsWith("chain-"))).toHaveLength(25);
    });

    it("reports dead-lettered jobs in the queue snapshot", async () => {
      await enqueue("route.unknown-type", {});
      const body = await (await POST(request("POST", { query: "?drain=true" }))).json();
      expect(body).toMatchObject({ ran: 2, succeeded: 1, failed: 1 });
      expect(body.queue.dead).toBe(1);
    });

    it("rejects a malformed query without running anything", async () => {
      await enqueue("route.work", { n: 3 });
      for (const query of ["?limit=0", "?limit=101", "?limit=abc", "?limit=2.5", "?drain=yes"]) {
        const res = await POST(request("POST", { query }));
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe("bad_request");
      }
      expect(ran).toEqual([]);
    });
  });

  describe("with CRON_SECRET set", () => {
    beforeEach(() => {
      vi.stubEnv("CRON_SECRET", SECRET);
    });

    it("rejects missing, malformed and wrong credentials and runs nothing", async () => {
      const { id } = await enqueue("route.work", { n: 4 });
      const attempts: Array<string | undefined> = [
        undefined,
        "",
        SECRET,
        `Bearer ${SECRET}x`,
        `Bearer ${SECRET.slice(0, -1)}`,
        `Bearer  ${SECRET}`,
        `bearer ${SECRET}`,
        `Basic ${SECRET}`,
        `Bearer ${SECRET} x`,
        "Bearer ",
        "Bearer undefined",
      ];
      for (const authorization of attempts) {
        for (const handler of [POST, GET]) {
          const res = await handler(request(handler === POST ? "POST" : "GET", { authorization, query: "?drain=1" }));
          expect(res.status, `authorization: ${JSON.stringify(authorization)}`).toBe(401);
          expect(await res.json()).toEqual({ error: { code: "unauthenticated", message: "A valid cron secret is required" } });
          expect(res.headers.get("cache-control")).toBe("no-store");
        }
      }
      expect(ran).toEqual([]);
      expect((await getJob(id)).status).toBe("queued");
      expect((await getJobStats()).byStatus.queued).toBe(1);
    });

    it("accepts the exact bearer secret on POST and GET", async () => {
      await enqueue("route.work", { n: 5 });
      const post = await POST(request("POST", { authorization: `Bearer ${SECRET}` }));
      expect(post.status).toBe(200);
      expect((await post.json()).ran).toBe(2);
      const get = await GET(request("GET", { authorization: `Bearer ${SECRET}` }));
      expect(get.status).toBe(200);
      expect((await get.json()).ran).toBe(0);
    });
  });

  describe("in production", () => {
    // env() keeps its first parse outside tests, so production behaviour needs a fresh module graph.
    async function productionRoute(cronSecret: string) {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CRON_SECRET", cronSecret);
      vi.resetModules();
      return import("./route");
    }
    afterEach(() => {
      vi.resetModules();
    });

    it("is closed when CRON_SECRET is not configured, whatever the caller sends", async () => {
      const route = await productionRoute("");
      await enqueue("route.work", { n: 6 });
      for (const authorization of [undefined, "Bearer ", "Bearer undefined", `Bearer ${SECRET}`]) {
        for (const handler of [route.POST, route.GET]) {
          const res = await handler(request(handler === route.POST ? "POST" : "GET", { authorization, query: "?drain=1" }));
          expect(res.status).toBe(401);
          expect((await res.json()).error.code).toBe("unauthenticated");
        }
      }
      // Operators get one log line, not one per request.
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(ran).toEqual([]);
    });

    it("requires the secret when one is configured", async () => {
      const route = await productionRoute(SECRET);
      expect((await route.GET(request("GET"))).status).toBe(401);
      expect((await route.POST(request("POST", { authorization: "Bearer wrong" }))).status).toBe(401);
      expect(ran).toEqual([]);
      const ok = await route.GET(request("GET", { authorization: `Bearer ${SECRET}` }));
      expect(ok.status).toBe(200);
      expect((await ok.json()).ok).toBe(true);
    });
  });
});
