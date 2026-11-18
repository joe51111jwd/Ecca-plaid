import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { useTestDb } from "../../../tests/helpers/db";
import { SENSITIVE_BODY_REMOVED, deliverEmail, getEmail, listOutbox, queueEmail, renderEmail, sendEmail, type SendEmailInput } from "./index";
import { jobHandlers, recurringJobs } from "./jobs";

const SYNTHETIC_KEY = "re_synthetic_test_key_do_not_use";
const message = (overrides: Partial<SendEmailInput> = {}): SendEmailInput => ({
  to: "parent@example.com",
  subject: "Your sign-in link",
  template: "magic_link",
  html: "<p>Sign in: <a href=\"https://app.example.org/auth?token=abc\">link</a></p>",
  text: "Sign in: https://app.example.org/auth?token=abc",
  ...overrides,
});

function resendReplies(...replies: Array<Response | Error>) {
  const queue = [...replies];
  const mock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => {
    const next = queue.shift() ?? new Error("no more mocked replies");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
const ok = (id: string) => new Response(JSON.stringify({ id }), { status: 200, headers: { "content-type": "application/json" } });
const useResend = () => {
  vi.stubEnv("EMAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", SYNTHETIC_KEY);
  vi.stubEnv("EMAIL_FROM", "Passport <no-reply@mail.example.org>");
};

describe("email", () => {
  const t = useTestDb();
  let fetchSpy: ReturnType<typeof resendReplies>;

  beforeEach(() => {
    // Any unexpected network call fails the test.
    fetchSpy = resendReplies();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setTestNow(null);
  });

  describe("outbox provider (default)", () => {
    it("records the message, marks it sent and lets nothing leave the machine", async () => {
      setTestNow("2026-12-01T09:30:00.000Z");
      const email = await sendEmail(message({ related: { type: "magic_link", id: "mlk_1" } }));
      expect(email).toMatchObject({
        id: expect.stringMatching(/^eml_/),
        toEmail: "parent@example.com",
        fromEmail: "Passport <no-reply@localhost>",
        subject: "Your sign-in link",
        template: "magic_link",
        status: "sent",
        provider: "outbox",
        providerId: null,
        error: null,
        relatedType: "magic_link",
        relatedId: "mlk_1",
      });
      expect(email.html).toContain("https://app.example.org/auth?token=abc");
      expect(email.createdAt).toEqual(new Date("2026-12-01T09:30:00.000Z"));
      expect(email.sentAt).toEqual(new Date("2026-12-01T09:30:00.000Z"));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await getEmail(email.id)).toEqual(email);
    });

    it("keeps the body of a sensitive message, because the outbox is where it is read", async () => {
      const email = await sendEmail(message({ sensitive: true }));
      expect(email.text).toBe("Sign in: https://app.example.org/auth?token=abc");
    });

    it("stores what renderEmail produced", async () => {
      const { html, text } = renderEmail({ heading: "Sign in", paragraphs: ["Hello <b>Ana</b>"], cta: { label: "Sign in", url: "https://app.example.org/a?t=1" } });
      const email = await sendEmail(message({ html, text }));
      expect(email.html).toBe(html);
      expect(email.text).toBe(text);
    });

    it("normalizes the recipient and the subject", async () => {
      const email = await sendEmail(message({ to: "  Parent.Name@Example.COM ", subject: "  Hello\r\nBcc: attacker@example.org\t there  " }));
      expect(email.toEmail).toBe("parent.name@example.com");
      expect(email.subject).toBe("Hello Bcc: attacker@example.org there");
      const long = await sendEmail(message({ subject: "s".repeat(400) }));
      expect(Array.from(long.subject)).toHaveLength(250);
      expect(long.subject.endsWith("…")).toBe(true);
    });

    it("rejects malformed messages without recording anything", async () => {
      const bad: Array<Partial<SendEmailInput>> = [
        { to: "not-an-email" },
        { to: "" },
        { to: "a@example.com, b@example.com" },
        { to: "Ana <ana@example.com>" },
        { to: "ana@example.com\r\nBcc: x@example.com" },
        { subject: "" },
        { subject: " \r\n " },
        { template: "" },
        { template: "has spaces" },
        { template: "x".repeat(101) },
        { html: "" },
        { text: "" },
        { related: { type: "", id: "x" } },
        { related: { type: "donation", id: "" } },
      ];
      for (const overrides of bad) {
        const err = await sendEmail(message(overrides)).catch((e: unknown) => e);
        expect(err, JSON.stringify(overrides)).toBeInstanceOf(AppError);
        expect(err, JSON.stringify(overrides)).toMatchObject({ code: "validation_failed" });
      }
      expect(await t.db.select().from(schema.emails)).toHaveLength(0);
    });

    it("warns once when production is left on the outbox, where nothing is ever delivered", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await sendEmail(message());
      expect(warn).not.toHaveBeenCalled();
      vi.stubEnv("NODE_ENV", "production");
      await sendEmail(message());
      await sendEmail(message());
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/NOT delivered/);
    });

    it("rolls back with the caller's transaction", async () => {
      await expect(
        t.db.transaction(async (tx) => {
          const email = await sendEmail(message(), tx);
          expect(await getEmail(email.id, tx)).not.toBeNull();
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await listOutbox()).toEqual([]);
    });
  });

  describe("queueEmail / deliverEmail", () => {
    it("records without delivering, then delivers on request", async () => {
      const queued = await queueEmail(message());
      expect(queued).toMatchObject({ status: "queued", sentAt: null, provider: "outbox" });
      const sent = await deliverEmail(queued.id);
      expect(sent).toMatchObject({ id: queued.id, status: "sent" });
      expect(sent.sentAt).not.toBeNull();
    });

    it("reports an unknown message", async () => {
      await expect(deliverEmail("eml_missing")).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("listOutbox / getEmail", () => {
    it("lists the most recently recorded first, even when the application clock is frozen", async () => {
      setTestNow("2027-01-15T12:00:00.000Z");
      const ids: string[] = [];
      for (let i = 0; i < 12; i++) ids.push((await sendEmail(message({ subject: `Message ${i}` }))).id);
      const listed = await listOutbox({ to: "parent@example.com" });
      expect(new Set(listed.map((e) => e.createdAt.getTime())).size).toBe(1);
      expect(listed.map((e) => e.id)).toEqual([...ids].reverse());
      expect(listed[0].subject).toBe("Message 11");
      expect((await listOutbox({ limit: 1 }))[0].subject).toBe("Message 11");
    });

    it("keeps recording order when the application clock jumps backwards", async () => {
      setTestNow("2027-03-01T00:00:00.000Z");
      await sendEmail(message({ subject: "Recorded first" }));
      setTestNow("2026-12-01T00:00:00.000Z");
      await sendEmail(message({ subject: "Recorded second" }));
      expect((await listOutbox()).map((e) => e.subject)).toEqual(["Recorded second", "Recorded first"]);
    });

    it("filters by recipient (case-insensitively) and by template", async () => {
      await sendEmail(message({ to: "a@example.com", template: "magic_link" }));
      await sendEmail(message({ to: "b@example.com", template: "magic_link" }));
      await sendEmail(message({ to: "a@example.com", template: "donation_receipt", subject: "Receipt" }));
      expect(await listOutbox()).toHaveLength(3);
      expect((await listOutbox({ to: "  A@Example.com " })).map((e) => e.subject)).toEqual(["Receipt", "Your sign-in link"]);
      expect((await listOutbox({ to: "a@example.com", template: "magic_link" })).map((e) => e.toEmail)).toEqual(["a@example.com"]);
      expect(await listOutbox({ template: "magic_link" })).toHaveLength(2);
      expect(await listOutbox({ to: "nobody@example.com" })).toEqual([]);
      expect(await listOutbox({ to: "" })).toHaveLength(3);
      expect(await listOutbox({ to: "a@example.com%" })).toEqual([]);
    });

    it("bounds the page size", async () => {
      for (let i = 0; i < 4; i++) await sendEmail(message());
      expect(await listOutbox({ limit: 2 })).toHaveLength(2);
      expect(await listOutbox({ limit: 0 })).toHaveLength(4);
      expect(await listOutbox({ limit: -5 })).toHaveLength(1);
      expect(await listOutbox({ limit: Number.NaN })).toHaveLength(4);
      expect(await listOutbox({ limit: 10_000 })).toHaveLength(4);
    });

    it("getEmail returns null for an unknown id", async () => {
      expect(await getEmail("eml_missing")).toBeNull();
    });
  });

  describe("resend provider", () => {
    beforeEach(useResend);

    it("posts the message to the Resend API and records the provider id", async () => {
      fetchSpy = resendReplies(ok("resend-msg-1"));
      const email = await sendEmail(message());
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.resend.com/emails");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ Authorization: `Bearer ${SYNTHETIC_KEY}`, "Content-Type": "application/json", "Idempotency-Key": email.id });
      expect(JSON.parse(init?.body as string)).toEqual({
        from: "Passport <no-reply@mail.example.org>",
        to: ["parent@example.com"],
        subject: "Your sign-in link",
        html: message().html,
        text: message().text,
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(email).toMatchObject({ status: "sent", provider: "resend", providerId: "resend-msg-1", error: null, fromEmail: "Passport <no-reply@mail.example.org>" });
      expect(email.sentAt).not.toBeNull();
      expect(email.html).toBe(message().html);
    });

    it("removes the body of a sensitive message once the provider has accepted it", async () => {
      fetchSpy = resendReplies(ok("resend-msg-2"));
      const email = await sendEmail(message({ sensitive: true }));
      expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string).text).toContain("token=abc");
      expect(email).toMatchObject({ status: "sent", html: SENSITIVE_BODY_REMOVED, text: SENSITIVE_BODY_REMOVED });
      expect(JSON.stringify(await getEmail(email.id))).not.toContain("token=abc");
    });

    it.each([
      ["a validation error", new Response(JSON.stringify({ statusCode: 422, name: "validation_error", message: "The `from` domain is not verified." }), { status: 422 }), "Resend responded 422: The `from` domain is not verified."],
      ["a rate limit", new Response(JSON.stringify({ statusCode: 429, message: "Too many requests" }), { status: 429 }), "Resend responded 429: Too many requests"],
      ["a non-JSON server error", new Response("<html>Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" }), "Resend responded 502: <html>Bad Gateway</html>"],
      ["an empty server error", new Response("", { status: 500, statusText: "Internal Server Error" }), "Resend responded 500: Internal Server Error"],
      ["a success without an id", new Response(JSON.stringify({}), { status: 200 }), "Resend accepted the request but returned no message id"],
      ["a network failure", new TypeError("fetch failed"), "Could not reach Resend: fetch failed"],
      ["a timeout", Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "Could not reach Resend: request timed out"],
    ])("marks the message failed and throws on %s", async (_label, reply, expectedError) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      fetchSpy = resendReplies(reply);
      const err = await sendEmail(message()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ code: "not_available", status: 503 });
      const [row] = await listOutbox();
      expect(row).toMatchObject({ status: "failed", provider: "resend", error: expectedError, sentAt: null, providerId: null });
      expect((err as AppError).details).toEqual({ emailId: row.id });
      // The caller-facing message and the log never contain provider internals or the key.
      expect((err as AppError).message).toBe("We could not send the email right now. Please try again in a moment.");
      expect(JSON.stringify([row, log.mock.calls, (err as AppError).message])).not.toContain(SYNTHETIC_KEY);
    });

    it("fails without calling the API when no key is configured", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubEnv("RESEND_API_KEY", "");
      await expect(sendEmail(message())).rejects.toMatchObject({ code: "not_available" });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((await listOutbox())[0]).toMatchObject({ status: "failed", error: "RESEND_API_KEY is not set" });
    });

    it("truncates a huge provider error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      fetchSpy = resendReplies(new Response("x".repeat(5000), { status: 500 }));
      await expect(sendEmail(message())).rejects.toBeInstanceOf(AppError);
      expect((await listOutbox())[0].error).toHaveLength(500);
    });

    it("retries a failed message with the same idempotency key and clears the error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      fetchSpy = resendReplies(new Response("{}", { status: 503 }), ok("resend-msg-3"));
      const failure = (await sendEmail(message({ sensitive: true })).catch((e: unknown) => e)) as AppError;
      const { emailId } = failure.details as { emailId: string };
      // The body is still there: the retry needs it.
      expect((await getEmail(emailId))!.text).toContain("token=abc");

      const sent = await deliverEmail(emailId, { redactAfterSend: true });
      expect(sent).toMatchObject({ status: "sent", providerId: "resend-msg-3", error: null, text: SENSITIVE_BODY_REMOVED });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const keys = fetchSpy.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)["Idempotency-Key"]);
      expect(keys).toEqual([emailId, emailId]);
    });

    it("never sends a message twice", async () => {
      fetchSpy = resendReplies(ok("resend-msg-4"));
      const email = await sendEmail(message());
      const again = await deliverEmail(email.id);
      expect(again).toEqual(email);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("delivers a message that was queued under the outbox provider through the current provider", async () => {
      vi.stubEnv("EMAIL_PROVIDER", "outbox");
      const queued = await queueEmail(message());
      expect(queued.provider).toBe("outbox");
      vi.stubEnv("EMAIL_PROVIDER", "resend");
      fetchSpy = resendReplies(ok("resend-msg-5"));
      expect(await deliverEmail(queued.id)).toMatchObject({ status: "sent", provider: "resend", providerId: "resend-msg-5" });
    });
  });

  describe('job handler "email.send"', () => {
    const ctx = { jobId: "job_test", attempt: 1 };

    it("exports the registry shape", () => {
      expect(Object.keys(jobHandlers)).toEqual(["email.send"]);
      expect(recurringJobs).toEqual([]);
    });

    it("delivers a queued message", async () => {
      const queued = await queueEmail(message());
      await jobHandlers["email.send"]({ emailId: queued.id }, ctx);
      expect(await getEmail(queued.id)).toMatchObject({ status: "sent", provider: "outbox" });
    });

    it("is idempotent: running again after success sends nothing", async () => {
      useResend();
      fetchSpy = resendReplies(ok("resend-msg-6"));
      const queued = await queueEmail(message());
      await jobHandlers["email.send"]({ emailId: queued.id }, ctx);
      const first = await getEmail(queued.id);
      await jobHandlers["email.send"]({ emailId: queued.id }, { ...ctx, attempt: 2 });
      await jobHandlers["email.send"]({ emailId: queued.id }, { ...ctx, attempt: 3 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(await getEmail(queued.id)).toEqual(first);
    });

    it("throws on a provider failure so the queue retries, then succeeds on the next attempt", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      useResend();
      fetchSpy = resendReplies(new TypeError("fetch failed"), ok("resend-msg-7"));
      const queued = await queueEmail(message());
      await expect(jobHandlers["email.send"]({ emailId: queued.id }, ctx)).rejects.toMatchObject({ code: "not_available" });
      expect(await getEmail(queued.id)).toMatchObject({ status: "failed", error: "Could not reach Resend: fetch failed" });
      await jobHandlers["email.send"]({ emailId: queued.id, redactAfterSend: true }, { ...ctx, attempt: 2 });
      expect(await getEmail(queued.id)).toMatchObject({ status: "sent", providerId: "resend-msg-7", error: null, html: SENSITIVE_BODY_REMOVED });
    });

    it("rejects a malformed payload and an unknown message", async () => {
      await expect(jobHandlers["email.send"]({}, ctx)).rejects.toThrow();
      await expect(jobHandlers["email.send"]({ emailId: "" }, ctx)).rejects.toThrow();
      await expect(jobHandlers["email.send"]({ emailId: 42 }, ctx)).rejects.toThrow();
      await expect(jobHandlers["email.send"]({ emailId: "eml_missing" }, ctx)).rejects.toMatchObject({ code: "not_found" });
    });
  });
});
