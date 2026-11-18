/**
 * Next.js instrumentation hook: `register` runs once when a server instance starts.
 *
 * With the embedded database there is no separate worker, so queued jobs run inside the web process
 * (`jobsInline()`). The imports sit inside the runtime check, in the shape the bundler recognizes, so
 * the Edge build of this file never pulls in the database or Node-only modules. A production build
 * must not start a job loop either.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const { jobsInline } = await import("@/lib/env");
    if (!jobsInline()) return;
    const { startInlineRunner } = await import("@/server/jobs/runner");
    startInlineRunner();
  }
}
