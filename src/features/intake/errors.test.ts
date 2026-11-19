import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { es } from "@/i18n/es";
import { AppError, conflict, invalid, notFound } from "@/lib/errors";
import { readUploadOutcome } from "./components/upload-result";
import { describeForLog, failure, localizeError, localizeFields } from "./errors";

afterEach(() => vi.restoreAllMocks());

describe("localizeError", () => {
  it("never shows internal details of an unexpected error", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = localizeError(new Error("SELECT * FROM users; stack..."), "es");
    expect(r).toEqual({ ok: false, error: { code: "internal", message: es.errors.generic } });
  });

  it("never writes the family's data to the log (database errors carry query parameters)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // The shape drizzle-orm's DrizzleQueryError gives a failed query (SYNTHETIC values).
    const pg = Object.assign(new Error('duplicate key value violates unique constraint "members_pkey"'), { detail: "Key (dob)=(2011-02-03) already exists." });
    const dbError = new Error('Failed query: insert into "household_members" ("first_name", "dob") values ($1, $2)\nparams: SYNTHETIC-Dana,2011-02-03', { cause: pg });
    dbError.name = "DrizzleQueryError";
    localizeError(dbError, "en");
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0]!.map(String).join(" ");
    expect(logged).toContain("DrizzleQueryError: Failed query: insert into");
    expect(logged).toContain("duplicate key value");
    expect(logged).not.toContain("SYNTHETIC-Dana");
    expect(logged).not.toContain("2011-02-03");
  });

  it("describes non-errors and deep cause chains without throwing", () => {
    expect(describeForLog("boom")).toBe("non-error string");
    let e: Error = new Error("root");
    for (let i = 0; i < 10; i++) e = new Error(`level ${i}`, { cause: e });
    expect(describeForLog(e).split(" <- caused by ")).toHaveLength(3);
  });

  it("uses details.reason first", () => {
    expect(localizeError(conflict("x", { reason: "already_submitted" }), "es").error.message).toBe(es.errors.alreadySubmitted);
    expect(localizeError(new AppError("forbidden", "x", { reason: "consent_revoked" }), "en").error.message).toBe(en.errors.consentRequired);
    expect(localizeError(invalid("x", { reason: "too_large" }), "es").error.message).toBe(es.errors.files.tooLarge);
  });

  it("maps known service sentences, and falls back by code for anything else", () => {
    expect(localizeError(invalid("Enter your address first."), "es").error.message).toBe(es.errors.addressFirst);
    expect(localizeError(notFound("Thing"), "es").error.message).toBe(es.errors.notFound);
    expect(localizeError(new AppError("rate_limited", "slow down"), "en").error.message).toBe(en.errors.rateLimited);
    expect(localizeError(conflict("Some new English sentence"), "es").error.message).toBe(es.errors.generic);
  });

  it("uses a caller's fallback sentence when there is no specific one", () => {
    expect(localizeError(conflict("taken"), "en", { fallback: "inviteConflict" }).error.message).toBe(en.errors.inviteConflict);
  });

  it("localizes field errors and uses the single field's sentence as the message", () => {
    const r = localizeError(invalid("bad", { fields: { zip: "Enter a 5-digit ZIP code" } }), "es");
    expect(r.error).toEqual({ code: "validation_failed", message: es.errors.fields.zip, fields: { zip: es.errors.fields.zip } });
    const many = localizeError(invalid("bad", { fields: { zip: "z", city: "c" } }), "en");
    expect(many.error.message).toBe(en.errors.fields.generic);
  });
});

describe("localizeFields", () => {
  it("maps service field names onto form fields and Texas messages onto the state field", () => {
    expect(localizeFields({ owner_member: "x", student: "y" }, "en")).toEqual({ firstName: en.errors.fields.firstName, students: en.errors.fields.students });
    expect(localizeFields({ zip: "Right now we can only verify households that live in Texas." }, "es")).toEqual({ zip: es.errors.fields.state });
  });

  it("never shows a raw English sentence on a Spanish screen", () => {
    expect(localizeFields({ mystery: "Raw English" }, "es")).toEqual({ mystery: es.errors.fields.generic });
    expect(localizeFields({ mystery: "Raw English" }, "en")).toEqual({ mystery: "Raw English" });
  });
});

describe("failure", () => {
  it("omits fields when there are none", () => {
    expect(failure("not_found", "m")).toEqual({ ok: false, error: { code: "not_found", message: "m" } });
  });
});

describe("readUploadOutcome", () => {
  it("reads success, duplicates and server messages", () => {
    expect(readUploadOutcome({ status: 201, body: { ok: true, data: { duplicate: false } } }, "en")).toEqual({ kind: "ok" });
    expect(readUploadOutcome({ status: 200, body: { ok: true, data: { duplicate: true } } }, "es")).toEqual({ kind: "duplicate", message: es.errors.files.duplicate });
    expect(readUploadOutcome({ status: 422, body: { ok: false, error: { message: "Elija el tipo" } } }, "es")).toEqual({ kind: "error", message: "Elija el tipo" });
  });

  it("explains network failures, bodies that are not ours and size refusals", () => {
    expect(readUploadOutcome({ status: 0, body: null }, "es")).toEqual({ kind: "error", message: es.errors.network });
    expect(readUploadOutcome({ status: 413, body: "<html>too big</html>" }, "en")).toEqual({ kind: "error", message: en.errors.files.tooLarge });
    expect(readUploadOutcome({ status: 401, body: null }, "en")).toEqual({ kind: "error", message: en.errors.signInAgain });
    expect(readUploadOutcome({ status: 500, body: [1, 2] }, "en")).toEqual({ kind: "error", message: en.errors.generic });
    expect(readUploadOutcome({ status: 500, body: { ok: true, data: {} } }, "en")).toEqual({ kind: "error", message: en.errors.generic });
    expect(readUploadOutcome({ status: 422, body: { ok: false, error: { message: "   " } } }, "en")).toEqual({ kind: "error", message: en.errors.generic });
  });
});
