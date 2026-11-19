import { describe, expect, it } from "vitest";
import { isAppError } from "@/lib/errors";
import {
  parseApiKeyCreate,
  parseCancel,
  parseComplete,
  parseExtendHold,
  parseInvite,
  parseOrigins,
  parsePartnershipRequest,
  parseProfile,
  parseRoleChange,
  parseSignup,
  parseWebhookCreate,
  parseWebhookTarget,
} from "./forms";

function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

function fieldsOf(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (e) {
    if (isAppError(e) && e.code === "validation_failed") return ((e.details as { fields?: Record<string, string> }) ?? {}).fields ?? { form: e.message };
    throw e;
  }
  throw new Error("expected a validation error");
}

describe("handoff forms", () => {
  it("parses a hold extension in whole hours", () => {
    expect(parseExtendHold(fd({ orgId: "org_1", handoffId: "hof_1", hours: "24" }))).toEqual({ orgId: "org_1", handoffId: "hof_1", hours: 24 });
  });

  it.each(["", "0", "-5", "1.5", "abc", "99999"])("refuses hours=%j", (hours) => {
    expect(fieldsOf(() => parseExtendHold(fd({ orgId: "org_1", handoffId: "hof_1", hours })))).toHaveProperty("hours");
  });

  it("requires the ids", () => {
    expect(fieldsOf(() => parseExtendHold(fd({ orgId: "", handoffId: "", hours: "1" })))).toMatchObject({ orgId: expect.any(String), handoffId: expect.any(String) });
  });

  it("parses the optional final amount in dollars", () => {
    expect(parseComplete(fd({ orgId: "o", handoffId: "h" }))).toEqual({ orgId: "o", handoffId: "h" });
    expect(parseComplete(fd({ orgId: "o", handoffId: "h", bookingAmount: "  " }))).toEqual({ orgId: "o", handoffId: "h" });
    expect(parseComplete(fd({ orgId: "o", handoffId: "h", bookingAmount: "$1,250.50" }))).toEqual({ orgId: "o", handoffId: "h", bookingAmountCents: 125_050 });
  });

  it.each(["0", "-3", "12.345", "ten"])("refuses bookingAmount=%j", (bookingAmount) => {
    expect(fieldsOf(() => parseComplete(fd({ orgId: "o", handoffId: "h", bookingAmount })))).toHaveProperty("bookingAmount");
  });

  it("collapses whitespace in a cancel reason and drops an empty one", () => {
    expect(parseCancel(fd({ orgId: "o", handoffId: "h", reason: "  moved \n to   session 3 " }))).toEqual({ orgId: "o", handoffId: "h", reason: "moved to session 3" });
    expect(parseCancel(fd({ orgId: "o", handoffId: "h", reason: "   " }))).toEqual({ orgId: "o", handoffId: "h" });
    expect(fieldsOf(() => parseCancel(fd({ orgId: "o", handoffId: "h", reason: "x".repeat(501) })))).toHaveProperty("reason");
  });
});

describe("settings forms", () => {
  it("sends only the fields present", () => {
    expect(parseProfile(fd({ orgId: "o", brandColor: " #1f5c3f ", logoUrl: "" }))).toEqual({ orgId: "o", patch: { brandColor: "#1f5c3f", logoUrl: "" } });
    expect(parseProfile(fd({ orgId: "o", holdWindowHours: "48", vendorType: "tutoring" }))).toEqual({ orgId: "o", patch: { holdWindowHours: 48, vendorType: "tutoring" } });
  });

  it("refuses an unknown vendor type and a non-numeric hold window", () => {
    expect(fieldsOf(() => parseProfile(fd({ orgId: "o", vendorType: "casino" })))).toHaveProperty("vendorType");
    expect(fieldsOf(() => parseProfile(fd({ orgId: "o", holdWindowHours: "3 days" })))).toHaveProperty("holdWindowHours");
  });

  it("refuses an empty form", () => {
    expect(() => parseProfile(fd({ orgId: "o" }))).toThrow("Nothing to update.");
  });

  it("splits origins on lines, commas and spaces", () => {
    expect(parseOrigins(fd({ orgId: "o", allowedOrigins: "https://a.example\r\n\n https://b.example, https://c.example" }))).toEqual({ orgId: "o", allowedOrigins: ["https://a.example", "https://b.example", "https://c.example"] });
    expect(parseOrigins(fd({ orgId: "o", allowedOrigins: "" }))).toEqual({ orgId: "o", allowedOrigins: [] });
  });

  it("requires an SGO for a partnership request", () => {
    expect(fieldsOf(() => parsePartnershipRequest(fd({ orgId: "o", sgoOrgId: "" })))).toHaveProperty("sgoOrgId");
  });
});

describe("team and developer forms", () => {
  it("accepts only known roles", () => {
    expect(parseInvite(fd({ orgId: "o", email: " a@example.org ", role: "reviewer" }))).toEqual({ orgId: "o", email: "a@example.org", role: "reviewer" });
    expect(fieldsOf(() => parseInvite(fd({ orgId: "o", email: "a@example.org", role: "superuser" })))).toHaveProperty("role");
    expect(fieldsOf(() => parseRoleChange(fd({ orgId: "o", userId: "u", role: "" })))).toHaveProperty("role");
  });

  it("parses API key and webhook forms", () => {
    expect(parseApiKeyCreate(fd({ orgId: "o", name: " Booking server ", mode: "test" }))).toEqual({ orgId: "o", name: "Booking server", mode: "test" });
    expect(fieldsOf(() => parseApiKeyCreate(fd({ orgId: "o", name: "x", mode: "prod" })))).toHaveProperty("mode");
    expect(parseWebhookCreate(fd({ orgId: "o", url: "https://camp.example/hooks", description: " ", eventTypes: ["handoff.held", "handoff.eligible"] }))).toEqual({
      orgId: "o",
      url: "https://camp.example/hooks",
      description: null,
      eventTypes: ["handoff.held", "handoff.eligible"],
    });
    expect(fieldsOf(() => parseWebhookCreate(fd({ orgId: "o", url: "https://camp.example/hooks", description: "" })))).toHaveProperty("eventTypes");
    expect(fieldsOf(() => parseWebhookTarget(fd({ orgId: "o", endpointId: "" })))).toHaveProperty("endpointId");
  });
});

describe("signup form", () => {
  it("parses and normalizes", () => {
    expect(parseSignup(fd({ name: " Synthetic Camp ", vendorType: "summer_camp", website: "", billingEmail: "billing@synthetic-camp.example" }))).toEqual({
      name: "Synthetic Camp",
      vendorType: "summer_camp",
      website: null,
      billingEmail: "billing@synthetic-camp.example",
    });
  });

  it("names every missing field", () => {
    expect(fieldsOf(() => parseSignup(fd({ name: "", vendorType: "", website: "", billingEmail: "" })))).toMatchObject({ name: expect.any(String), vendorType: expect.any(String), billingEmail: expect.any(String) });
  });
});
