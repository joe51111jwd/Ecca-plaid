import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";
import { useTestDb } from "../../../tests/helpers/db";
import { inlineRunnerStatus, stopInlineRunner } from "./runner";

/** The Next.js instrumentation hook decides whether this process runs queued jobs itself. */
describe("instrumentation register()", () => {
  useTestDb();

  beforeEach(() => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("JOBS_INLINE", "");
    vi.stubEnv("DATABASE_URL", "");
  });
  afterEach(async () => {
    // Stopped before its first tick (1.5 s away), so nothing is ever run here.
    await stopInlineRunner();
    vi.unstubAllEnvs();
  });

  it("starts the inline runner in the Node.js runtime with the embedded database", async () => {
    await register();
    expect(inlineRunnerStatus()).toMatchObject({ running: true, ticks: 0 });
  });

  it("keeps a single runner when the hook runs again", async () => {
    await register();
    await register();
    expect(inlineRunnerStatus().running).toBe(true);
    await stopInlineRunner();
    expect(inlineRunnerStatus().running).toBe(false);
  });

  it("does nothing outside the Node.js runtime", async () => {
    for (const runtime of ["edge", ""]) {
      vi.stubEnv("NEXT_RUNTIME", runtime);
      await register();
      expect(inlineRunnerStatus().running, `NEXT_RUNTIME=${JSON.stringify(runtime)}`).toBe(false);
    }
  });

  it("does nothing during a production build", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await register();
    expect(inlineRunnerStatus().running).toBe(false);
  });

  it("does nothing when JOBS_INLINE is false", async () => {
    vi.stubEnv("JOBS_INLINE", "false");
    await register();
    expect(inlineRunnerStatus().running).toBe(false);
  });

  it("leaves jobs to the worker when a real database is configured, unless JOBS_INLINE asks otherwise", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://synthetic:synthetic@db.invalid:5432/app");
    await register();
    expect(inlineRunnerStatus().running).toBe(false);
    vi.stubEnv("JOBS_INLINE", "true");
    await register();
    expect(inlineRunnerStatus().running).toBe(true);
  });
});
