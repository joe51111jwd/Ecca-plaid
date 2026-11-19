import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { MS, setTestNow } from "@/lib/clock";
import { OLD_BODY_REMOVED } from "@/server/email";
import { allJobHandlers, allRecurringJobs } from "@/server/jobs/registry";
import { useTestDb } from "../../../tests/helpers/db";
import { MAINTENANCE_CLEANUP_JOB, runCleanup } from "./jobs";

const T0 = new Date("2026-11-18T15:00:00Z");
const ago = (ms: number) => new Date(T0.getTime() - ms);

describe("maintenance cleanup", () => {
  useTestDb();

  beforeEach(() => setTestNow(T0));
  afterEach(() => setTestNow(null));

  it("is registered as an hourly job", () => {
    expect(allJobHandlers()[MAINTENANCE_CLEANUP_JOB]).toBeTypeOf("function");
    expect(allRecurringJobs()).toContainEqual({ type: MAINTENANCE_CLEANUP_JOB, everyMs: MS.hour });
  });

  it("removes what has aged out and keeps what is still in use", async () => {
    const db = await getDb();
    await db.insert(schema.users).values({ id: "usr_synthetic_cleanup", email: "cleanup@example.com" });

    await db.insert(schema.sessions).values([
      { id: "ses_old", userId: "usr_synthetic_cleanup", tokenHash: "h-old", createdAt: ago(90 * MS.day), expiresAt: ago(60 * MS.day) },
      { id: "ses_live", userId: "usr_synthetic_cleanup", tokenHash: "h-live", createdAt: ago(MS.hour), lastSeenAt: ago(MS.minute), expiresAt: new Date(T0.getTime() + MS.day) },
    ]);
    await db.insert(schema.magicLinks).values([
      { id: "ml_old", email: "cleanup@example.com", tokenHash: "t-old", codeHash: "c-old", expiresAt: ago(2 * MS.day), consumedAt: ago(2 * MS.day) },
      { id: "ml_recent", email: "cleanup@example.com", tokenHash: "t-recent", codeHash: "c-recent", expiresAt: ago(MS.hour) },
      { id: "ml_open", email: "cleanup@example.com", tokenHash: "t-open", codeHash: "c-open", expiresAt: new Date(T0.getTime() + 10 * MS.minute) },
    ]);
    const mail = { toEmail: "cleanup@example.com", fromEmail: "no-reply@example.com", subject: "Synthetic", template: "receipt", html: "<p>body</p>", text: "body" };
    await db.insert(schema.emails).values([
      { ...mail, id: "eml_old_sent", status: "sent", createdAt: ago(45 * MS.day) },
      { ...mail, id: "eml_old_queued", status: "queued", createdAt: ago(45 * MS.day) },
      { ...mail, id: "eml_new_sent", status: "sent", createdAt: ago(MS.day) },
    ]);

    const first = await runCleanup();
    expect(first).toMatchObject({ sessions: 1, magicLinks: 1, emailBodies: 1 });

    expect((await db.select({ id: schema.sessions.id }).from(schema.sessions)).map((r) => r.id)).toEqual(["ses_live"]);
    expect((await db.select({ id: schema.magicLinks.id }).from(schema.magicLinks)).map((r) => r.id).sort()).toEqual(["ml_open", "ml_recent"]);
    const [oldSent] = await db.select().from(schema.emails).where(eq(schema.emails.id, "eml_old_sent"));
    expect(oldSent).toMatchObject({ html: OLD_BODY_REMOVED, text: OLD_BODY_REMOVED, subject: "Synthetic" });
    const [oldQueued] = await db.select().from(schema.emails).where(eq(schema.emails.id, "eml_old_queued"));
    expect(oldQueued.text).toBe("body");
    const [newSent] = await db.select().from(schema.emails).where(eq(schema.emails.id, "eml_new_sent"));
    expect(newSent.text).toBe("body");

    // A second run finds nothing left to do.
    expect(await runCleanup()).toEqual({ sessions: 0, magicLinks: 0, idempotencyKeys: 0, rateLimits: 0, emailBodies: 0 });
  });
});
