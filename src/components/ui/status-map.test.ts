import { describe, expect, it } from "vitest";
import type { HandoffStatus, InvoiceStatus } from "@/db/schema/business";
import type { DeliveryStatus, EmailStatus, JobStatus, OrgStatus } from "@/db/schema/core";
import type { CheckoutStatus, PaymentStatus } from "@/db/schema/donation";
import type { SgoListSource } from "@/db/schema/sgo";
import type { Mode } from "@/db/schema/_shared";
import type { AwardStatus, DocumentStatus, RailStatus, ThresholdSource, VerificationMethod, VerificationStage, VerificationStatus } from "@/db/schema/verification";
import { TONE_SOFT } from "./badge";
import { STATUS_KINDS, STATUS_MAP, STATUS_VALUES, statusLabel, statusSpec, type StatusKind, type StatusKinds } from "./status-map";

/**
 * Builds a value list for a union and fails to COMPILE (tsc) when the list misses a member of the union or
 * contains something outside it. The schema exports these unions as types only, so the lists are mirrored
 * here and this guard keeps the mirror honest.
 */
function allOf<Union extends string>() {
  return <const List extends readonly Union[]>(list: List & ([Union] extends [List[number]] ? unknown : readonly ["missing union members", Exclude<Union, List[number]>])): readonly Union[] => list;
}

/** Every status-like union in src/db/schema, mirrored as values. Named unions and inline `$type<…>()` unions alike. */
const SCHEMA_VALUES: { [K in StatusKind]: ReadonlyArray<StatusKinds[K]> } = {
  verification: allOf<VerificationStatus>()(["pending", "eligible", "ineligible", "needs_review", "expired", "canceled"]),
  stage: allOf<VerificationStage>()(["created", "started", "consented", "household", "collecting", "submitted", "processing", "awaiting_family", "in_review", "decided"]),
  method: allOf<VerificationMethod>()(["direct", "categorical"]),
  threshold_source: allOf<ThresholdSource>()(["hud_provisional", "irs_published"]),
  document: allOf<DocumentStatus>()(["uploaded", "extracting", "extracted", "needs_review", "rejected", "purged"]),
  rail: allOf<RailStatus>()(["created", "connecting", "connected", "syncing", "ready", "failed", "declined", "revoked"]),
  review_task: allOf<StatusKinds["review_task"]>()(["open", "resolved"]),
  award: allOf<AwardStatus>()(["offered", "accepted", "paid", "declined", "revoked"]),
  handoff: allOf<HandoffStatus>()(["started", "verifying", "held", "eligible", "awarded", "completed", "declined", "expired", "canceled"]),
  partnership: allOf<StatusKinds["partnership"]>()(["pending", "active", "ended"]),
  invoice: allOf<InvoiceStatus>()(["draft", "open", "paid", "void", "uncollectible"]),
  checkout: allOf<CheckoutStatus>()(["open", "awaiting_payment", "completed", "expired", "canceled"]),
  payment: allOf<PaymentStatus>()(["requires_payment", "processing", "succeeded", "failed", "canceled", "refunded"]),
  donation: allOf<StatusKinds["donation"]>()(["pending", "succeeded", "failed", "canceled", "refunded"]),
  acknowledgment: allOf<StatusKinds["acknowledgment"]>()(["draft", "issued", "superseded", "blocked"]),
  fee: allOf<StatusKinds["fee"]>()(["accrued", "invoiced", "paid", "waived", "void"]),
  sgo_list: allOf<StatusKinds["sgo_list"]>()(["listed", "removed"]),
  sgo_list_source: allOf<SgoListSource>()(["provisional_curated", "irs_published"]),
  org: allOf<OrgStatus>()(["pending", "active", "suspended"]),
  webhook_endpoint: allOf<StatusKinds["webhook_endpoint"]>()(["active", "disabled"]),
  webhook_delivery: allOf<DeliveryStatus>()(["pending", "succeeded", "failed", "dead"]),
  job: allOf<JobStatus>()(["queued", "running", "succeeded", "failed", "dead"]),
  email: allOf<EmailStatus>()(["queued", "sent", "failed"]),
  mode: allOf<Mode>()(["test", "live"]),
};

describe("STATUS_MAP covers every status in the data model", () => {
  it("has a kind for every mirrored union and no others", () => {
    expect([...STATUS_KINDS].sort()).toEqual(Object.keys(SCHEMA_VALUES).sort());
  });

  for (const kind of Object.keys(SCHEMA_VALUES) as StatusKind[]) {
    describe(kind, () => {
      it("maps exactly the union's members", () => {
        expect(Object.keys(STATUS_MAP[kind]).sort()).toEqual([...SCHEMA_VALUES[kind]].sort());
        expect([...STATUS_VALUES[kind]].sort()).toEqual([...SCHEMA_VALUES[kind]].sort());
      });

      it("gives every member a label, a known tone, an icon and a one-sentence meaning", () => {
        for (const status of SCHEMA_VALUES[kind]) {
          const spec = statusSpec(kind, status);
          expect(spec, `${kind}.${status}`).not.toBeNull();
          if (!spec) continue;
          expect(spec.label.trim(), `${kind}.${status} label`).not.toBe("");
          expect(spec.label, `${kind}.${status} label must be words, not the stored value`).not.toMatch(/_/);
          expect(Object.keys(TONE_SOFT), `${kind}.${status} tone`).toContain(spec.tone);
          expect(spec.icon, `${kind}.${status} icon`).toBeTruthy();
          expect(spec.description.trim().length, `${kind}.${status} description`).toBeGreaterThan(10);
          expect(spec.description.trim(), `${kind}.${status} description ends a sentence`).toMatch(/[.!]$/);
          if (spec.labelEs !== undefined) expect(spec.labelEs.trim()).not.toBe("");
        }
      });

      it("uses distinct labels within the kind, so two statuses never read the same", () => {
        const labels = SCHEMA_VALUES[kind].map((status) => statusLabel(kind, status));
        expect(new Set(labels).size).toBe(labels.length);
      });
    });
  }
});

describe("status rules that must hold everywhere", () => {
  it("anything provisional or sandbox uses the caution tone, and nothing else does", () => {
    const caution: string[] = [];
    for (const kind of STATUS_KINDS) {
      for (const status of STATUS_VALUES[kind]) {
        if (statusSpec(kind, status)?.tone === "caution") caution.push(`${kind}.${status}`);
      }
    }
    expect(caution.sort()).toEqual(["mode.test", "sgo_list_source.provisional_curated", "threshold_source.hud_provisional"]);
  });

  it("a verification that needs a person is a warning, never a success or a failure", () => {
    expect(STATUS_MAP.verification.needs_review.tone).toBe("warning");
    expect(STATUS_MAP.stage.in_review.tone).toBe("warning");
    expect(STATUS_MAP.stage.awaiting_family.tone).toBe("warning");
    expect(STATUS_MAP.document.needs_review.tone).toBe("warning");
  });

  it("eligible is the only success among verification results; pending is not a failure", () => {
    const success = STATUS_VALUES.verification.filter((status) => STATUS_MAP.verification[status].tone === "success");
    expect(success).toEqual(["eligible"]);
    expect(STATUS_MAP.verification.pending.tone).not.toBe("danger");
    expect(STATUS_MAP.verification.ineligible.tone).toBe("danger");
  });

  it("a handoff that is merely eligible does not look paid: an award is a separate decision", () => {
    expect(STATUS_MAP.handoff.eligible.tone).not.toBe("success");
    expect(STATUS_MAP.handoff.eligible.description).toMatch(/not a promise of payment/);
    expect(STATUS_MAP.verification.eligible.description).toMatch(/not an award/);
    expect(STATUS_MAP.handoff.awarded.tone).toBe("success");
  });

  it("families get Spanish for every status they can see", () => {
    for (const kind of ["verification", "stage", "document", "rail", "award", "handoff", "mode"] as const) {
      for (const status of STATUS_VALUES[kind]) {
        const spec = statusSpec(kind, status);
        expect(spec?.labelEs, `${kind}.${status} Spanish label`).toBeTruthy();
        expect(statusLabel(kind, status, "es")).toBe(spec?.labelEs);
      }
    }
  });
});

describe("statusSpec / statusLabel with values this build does not know", () => {
  it("returns null and a readable fallback instead of throwing", () => {
    expect(statusSpec("verification", "brand_new_status")).toBeNull();
    expect(statusLabel("verification", "brand_new_status")).toBe("brand new status");
    expect(statusLabel("verification", "")).toBe("");
  });

  it("is not fooled by Object.prototype keys", () => {
    expect(statusSpec("verification", "constructor")).toBeNull();
    expect(statusSpec("verification", "toString")).toBeNull();
    expect(statusSpec("verification", "__proto__")).toBeNull();
    expect(statusLabel("payment", "hasOwnProperty")).toBe("hasOwnProperty");
  });

  it("falls back to English when a staff-only kind has no Spanish label", () => {
    expect(statusLabel("invoice", "uncollectible", "es")).toBe("Uncollectible");
    expect(statusLabel("verification", "eligible", "es")).toBe("Elegible");
    expect(statusLabel("verification", "eligible", "en")).toBe("Eligible");
  });
});
