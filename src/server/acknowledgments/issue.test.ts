import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { extractPdfText } from "@/engine/evidence/test-support";
import { setTestNow } from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import { isAppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { listAuditLogs } from "@/server/audit";
import { listEvents } from "@/server/events";
import { updateSgoProfile } from "@/server/sgos";
import { getObjectBytes } from "@/server/storage";
import { renderCopy } from "@/taxmath";
import { useTestDb } from "../../../tests/helpers/db";
import {
  buildAcknowledgment,
  buildLetter,
  downloadAcknowledgmentForUser,
  downloadAcknowledgmentPdf,
  generateSandboxDonorNumber,
  getDonorAcknowledgments,
  issueAcknowledgment,
  LETTER_COPY,
  LETTER_COPY_SHA256,
  LETTER_COPY_VERSION,
  listPaperMailings,
  markAcknowledgmentMailed,
  markAcknowledgmentStale,
  renderAcknowledgmentPdf,
  setDonorNumber,
  withdrawEDelivery,
} from "./index";
import { createStaff, createTestSgo, hideEnumerableArrayExtensions, insertConsent, insertDonor, insertGift, SYS, type TestSgo } from "./test-support";

/* Synthetic organizations, donors, gifts and numbers. */

const NOW = new Date("2028-01-05T16:00:00.000Z");
const STAFF = (id: string) => ({ actor: { type: "user" as const, id } });

async function errorOf(p: Promise<unknown>): Promise<{ code: string; message: string; details: unknown }> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return { code: e.code, message: e.message, details: e.details };
    throw e;
  }
  throw new Error("expected an error");
}

async function pdfText(objectId: string, orgId: string): Promise<string> {
  return (await extractPdfText(new Uint8Array(await getObjectBytes(objectId, { orgId })))).text;
}

describe("official acknowledgments", () => {
  const t = useTestDb();
  let sgo: TestSgo;
  let admin: string;
  let donor: string;

  beforeAll(() => hideEnumerableArrayExtensions());

  beforeEach(async () => {
    setTestNow(NOW);
    sgo = await createTestSgo({ name: "Synthetic Scholarship Fund", portalRegistered: true });
    admin = await createStaff(sgo.orgId, "admin");
    donor = await insertDonor({ firstName: "Avery", lastName: "Synthetic", email: "avery@synthetic.example" });
  });
  afterEach(() => setTestNow(null));

  const acks = () => t.db.select().from(schema.acknowledgments);

  describe("blocked", () => {
    it("is blocked with a precise reason when the SGO EIN is missing, and issues once it is added (same version)", async () => {
      const noEin = await createTestSgo({ ein: null, portalRegistered: true });
      await insertGift({ orgId: noEin.orgId, donorId: donor, mode: "live" });
      await setDonorNumber(noEin.orgId, { donorId: donor, taxYear: 2027, mode: "live", number: "SYN-0001" }, SYS);
      const result = await issueAcknowledgment(noEin.orgId, { donorId: donor, taxYear: 2027, mode: "live" }, SYS);
      expect(result.outcome).toBe("blocked");
      expect(result.acknowledgment).toMatchObject({ status: "blocked", version: 1, pdfObjectId: null, issuedAt: null, blockers: [{ code: "sgo_ein_missing" }] });
      expect(result.acknowledgment?.blockedReason).toMatch(/EIN is not on file/);
      expect((await listAuditLogs({ action: "acknowledgment.blocked" })).items).toHaveLength(1);
      // Re-running without a change does not audit again.
      await issueAcknowledgment(noEin.orgId, { donorId: donor, taxYear: 2027, mode: "live" }, SYS);
      expect((await listAuditLogs({ action: "acknowledgment.blocked" })).items).toHaveLength(1);

      await updateSgoProfile(noEin.orgId, { ein: "00-7654321" }, SYS);
      const issued = await issueAcknowledgment(noEin.orgId, { donorId: donor, taxYear: 2027, mode: "live" }, SYS);
      expect(issued.acknowledgment).toMatchObject({ status: "issued", version: 1, sgoEin: "00-7654321", uniqueDonorNumber: "SYN-0001", blockers: [], blockedReason: null });
      expect(await acks()).toHaveLength(1);
    });

    it("is blocked while the donor has no unique donor number, saying why (no portal registration vs. not entered)", async () => {
      const unregistered = await createTestSgo({ portalRegistered: false });
      await insertGift({ orgId: unregistered.orgId, donorId: donor, mode: "live" });
      const a = await issueAcknowledgment(unregistered.orgId, { donorId: donor, taxYear: 2027, mode: "live" }, SYS);
      expect(a.build.blockers.map((b) => b.code)).toEqual(["donor_number_pending_sgo_registration"]);
      await insertGift({ orgId: sgo.orgId, donorId: donor, mode: "live" });
      const b = await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "live" }, SYS);
      expect(b.build.blockers.map((x) => x.code)).toEqual(["donor_number_missing"]);
      expect(b.acknowledgment?.uniqueDonorNumber).toBeNull();
    });

    it("never puts a sandbox number on a live acknowledgment", async () => {
      await insertGift({ orgId: sgo.orgId, donorId: donor, mode: "live" });
      await t.db.insert(schema.donorNumbers).values({ id: newId("donorNumber"), orgId: sgo.orgId, donorId: donor, taxYear: 2027, mode: "live", number: "TEST-2027-SYNTHETIC", source: "sandbox_generated" });
      const r = await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "live" }, SYS);
      expect(r.build.blockers.map((b) => b.code)).toEqual(["sandbox_donor_number_in_live"]);
    });

    it("needs a description whenever goods or services were recorded", async () => {
      await insertGift({ orgId: sgo.orgId, donorId: donor, goods: { valueCents: 2_500, description: null } });
      await generateSandboxDonorNumber(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      const r = await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      expect(r.build.blockers.map((b) => b.code)).toEqual(["goods_or_services_description_missing"]);
    });

    it("is not required when every gift was refunded before anything was issued, and blocked for review when after", async () => {
      await insertGift({ orgId: sgo.orgId, donorId: donor, status: "refunded" });
      expect((await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS)).outcome).toBe("not_required");
      expect(await acks()).toHaveLength(0);

      const second = await insertDonor({ firstName: "Blake" });
      const gift = await insertGift({ orgId: sgo.orgId, donorId: second });
      await generateSandboxDonorNumber(sgo.orgId, { donorId: second, taxYear: 2027, mode: "test" }, SYS);
      expect((await issueAcknowledgment(sgo.orgId, { donorId: second, taxYear: 2027, mode: "test" }, SYS)).outcome).toBe("issued");
      await t.db.update(schema.donations).set({ status: "refunded", refundedAt: NOW }).where(eq(schema.donations.id, gift));
      const r = await issueAcknowledgment(sgo.orgId, { donorId: second, taxYear: 2027, mode: "test" }, SYS);
      expect(r).toMatchObject({ outcome: "blocked", acknowledgment: { version: 2, blockers: [{ code: "all_contributions_refunded" }] } });
      // The version the donor holds stays in force until a person decides.
      expect((await acks()).find((a) => a.version === 1)).toMatchObject({ status: "issued" });
    });

    it("does not reveal another SGO's donor or a year without gifts", async () => {
      const other = await createTestSgo();
      await insertGift({ orgId: other.orgId, donorId: donor });
      expect((await errorOf(issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS))).code).toBe("not_found");
      expect((await errorOf(buildAcknowledgment(other.orgId, donor, 2026, { mode: "test" }))).code).toBe("not_found");
      // Test gifts are invisible to a live acknowledgment, and the other way round.
      expect((await errorOf(buildAcknowledgment(other.orgId, donor, 2027, { mode: "live" }))).code).toBe("not_found");
    });
  });

  describe("issued", () => {
    it("issues a test-mode acknowledgment: all five items in the PDF, stored encrypted, emailed with consent, event and audit", async () => {
      const first = await insertGift({ orgId: sgo.orgId, donorId: donor, designatedCents: 100_000, contributedAt: new Date("2027-02-14T18:00:00Z") });
      const second = await insertGift({ orgId: sgo.orgId, donorId: donor, designatedCents: 70_000, contributedAt: new Date("2027-09-01T18:00:00Z") });
      await insertGift({ orgId: sgo.orgId, donorId: donor, designatedCents: 999_00, status: "refunded" });
      await insertGift({ orgId: sgo.orgId, donorId: donor, designatedCents: 888_00, mode: "live" });
      await insertConsent(sgo.orgId, donor, "avery@synthetic.example");
      const number = await generateSandboxDonorNumber(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);

      const r = await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, { userId: admin });
      expect(r.outcome).toBe("issued");
      const ack = r.acknowledgment!;
      expect(ack).toMatchObject({ status: "issued", version: 1, totalDesignatedCents: 170_000, sgoEin: sgo.ein, uniqueDonorNumber: number.number, delivery: "email", deliveryEmail: "avery@synthetic.example", issuedAt: NOW, issuedBy: admin, donationIds: [first, second] });
      expect(ack.snapshot?.gifts.map((g) => g.localDate)).toEqual(["2027-02-14", "2027-09-01"]);

      const [object] = await t.db.select().from(schema.objects).where(eq(schema.objects.id, ack.pdfObjectId!));
      expect(object).toMatchObject({ purpose: "acknowledgment_pdf", orgId: sgo.orgId, contentType: "application/pdf", sha256: ack.pdfSha256 });
      const bytes = await getObjectBytes(ack.pdfObjectId!, { orgId: sgo.orgId });
      expect(sha256Hex(bytes)).toBe(ack.pdfSha256);
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

      const text = await pdfText(ack.pdfObjectId!, sgo.orgId);
      // (A) EIN, (C) donor number, (B) total, (D) goods-or-services statement, all in the taxmath words.
      expect(text).toContain(renderCopy("ack.ein", { ein: sgo.ein! }));
      expect(text).toContain(renderCopy("ack.donor_number", { donorNumber: number.number }));
      expect(text).toContain("during calendar year 2027 that you designated as qualified contributions: $1,700.00");
      expect(text).toContain("Synthetic Scholarship Fund did not provide any goods or services in consideration, in whole or in part, for these contributions.");
      expect(text).toContain(renderCopy("ack.sandbox_donor_number"));
      expect(text).toContain("Avery Synthetic");
      expect(text).toContain("100 Synthetic Way");
      expect(text).toContain("Austin, TX 78701");
      expect(text).toContain("February 14, 2027");
      expect(text).toContain("September 1, 2027");
      expect(text).toContain("$1,000.00");
      expect(text).toContain("$700.00");
      expect(text).not.toContain("$999.00");
      expect(text).not.toContain("$888.00");
      expect(text).toContain("Form 8525");
      expect(text).toContain("not tax advice");
      expect(text).toContain(LETTER_COPY.testWatermark);
      expect(text).toContain(LETTER_COPY.testNotice);
      expect(text).not.toMatch(/\bfree\b/i);

      const [email] = await t.db.select().from(schema.emails).where(eq(schema.emails.id, ack.emailId!));
      expect(email).toMatchObject({ toEmail: "avery@synthetic.example", template: "acknowledgment", relatedType: "acknowledgment", relatedId: ack.id });
      expect(email.subject).toMatch(/^\[Sandbox\] Written acknowledgment of section 25F qualified contributions \(2027\)/);
      expect(email.text).toContain(renderCopy("ack.donor_number", { donorNumber: number.number }));

      const events = await listEvents({ orgId: sgo.orgId, mode: "test" });
      expect(events.map((e) => e.type)).toEqual(["acknowledgment.issued"]);
      expect(events[0].payload).toMatchObject({ id: ack.id, object: "acknowledgment", total_designated_cents: 170_000, version: 1, supersedes: null, delivery: "email" });
      expect(JSON.stringify(events[0].payload)).not.toMatch(/avery@|Synthetic Way/);
      expect((await listAuditLogs({ action: "acknowledgment.issue" })).items[0]).toMatchObject({ actorId: admin, orgId: sgo.orgId });
    });

    it("issues a live acknowledgment without any test labels", async () => {
      await insertGift({ orgId: sgo.orgId, donorId: donor, mode: "live" });
      await setDonorNumber(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "live", number: "SYN-0001" }, SYS);
      const r = await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "live" }, SYS);
      const text = await pdfText(r.acknowledgment!.pdfObjectId!, sgo.orgId);
      expect(text).toContain("Your unique donor number: SYN-0001");
      expect(text).not.toContain(LETTER_COPY.testWatermark);
      expect(text).not.toContain("not valid for filing");
      expect(r.acknowledgment?.delivery).toBe("paper_required");
    });

    it("prints goods or services with their description and good-faith value, and the non-designated part of each gift", async () => {
      await insertGift({ orgId: sgo.orgId, donorId: donor, designatedCents: 170_000, nonDesignatedCents: 30_000, goods: { valueCents: 4_500, description: "Synthetic gala dinner" } });
      await generateSandboxDonorNumber(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      const r = await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      expect(r.acknowledgment).toMatchObject({ goodsOrServicesProvided: true, goodsOrServicesValueCents: 4_500, goodsOrServicesDescription: "Synthetic gala dinner", nonDesignatedCents: 30_000 });
      const text = await pdfText(r.acknowledgment!.pdfObjectId!, sgo.orgId);
      expect(text).toContain("provided goods or services in consideration, in whole or in part, for these contributions. Description: Synthetic gala dinner. Good faith estimate of value: $45.00.");
      expect(text).toContain("$300.00");
      expect(text).toContain(LETTER_COPY.giftsNote.slice(0, 40));
    });

    it("returns unchanged when nothing changed, and supersedes with a new version when a later gift arrives", async () => {
      await insertGift({ orgId: sgo.orgId, donorId: donor, designatedCents: 100_000 });
      await generateSandboxDonorNumber(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      const v1 = (await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS)).acknowledgment!;
      const again = await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      expect(again).toMatchObject({ outcome: "unchanged", acknowledgment: { id: v1.id } });
      expect(await acks()).toHaveLength(1);

      setTestNow(new Date("2028-01-12T16:00:00Z"));
      await insertGift({ orgId: sgo.orgId, donorId: donor, designatedCents: 50_000, contributedAt: new Date("2027-12-31T20:00:00Z") });
      await markAcknowledgmentStale({ orgId: sgo.orgId, donorId: donor, taxYear: 2027, mode: "test", reason: "gift_succeeded" });
      const r = await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      expect(r.outcome).toBe("issued");
      expect(r.acknowledgment).toMatchObject({ version: 2, status: "issued", totalDesignatedCents: 150_000 });
      expect(r.superseded).toMatchObject({ id: v1.id, status: "superseded", supersededById: r.acknowledgment!.id });
      const text = await pdfText(r.acknowledgment!.pdfObjectId!, sgo.orgId);
      expect(text).toContain("This acknowledgment replaces version 1 issued on January 5, 2028");
      expect(text).toContain("$1,500.00");
      const events = await listEvents({ orgId: sgo.orgId, mode: "test" });
      expect(events.filter((e) => e.type === "acknowledgment.issued").map((e) => (e.payload as { supersedes: string | null }).supersedes)).toEqual(expect.arrayContaining([null, v1.id]));
      expect(await t.db.select().from(schema.acknowledgmentRefreshes)).toMatchObject([{ resolvedAt: expect.any(Date) }]);
      // Both versions remain stored and downloadable.
      expect((await downloadAcknowledgmentPdf(sgo.orgId, v1.id, STAFF(admin))).bytes.length).toBeGreaterThan(1000);
    });

    it("gives each spouse a separate acknowledgment with their own number", async () => {
      const spouse = await insertDonor({ firstName: "Riley", lastName: "Synthetic", email: "avery@synthetic.example" });
      await t.db.update(schema.donors).set({ spouseDonorId: spouse }).where(eq(schema.donors.id, donor));
      await insertGift({ orgId: sgo.orgId, donorId: donor, designatedCents: 170_000 });
      await insertGift({ orgId: sgo.orgId, donorId: spouse, designatedCents: 170_000 });
      const n1 = await generateSandboxDonorNumber(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      const n2 = await generateSandboxDonorNumber(sgo.orgId, { donorId: spouse, taxYear: 2027, mode: "test" }, SYS);
      expect(n1.number).not.toBe(n2.number);
      const a = await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      const b = await issueAcknowledgment(sgo.orgId, { donorId: spouse, taxYear: 2027, mode: "test" }, SYS);
      expect(a.acknowledgment?.id).not.toBe(b.acknowledgment?.id);
      expect(a.acknowledgment).toMatchObject({ uniqueDonorNumber: n1.number, totalDesignatedCents: 170_000 });
      expect(b.acknowledgment).toMatchObject({ uniqueDonorNumber: n2.number, totalDesignatedCents: 170_000 });
      const textB = await pdfText(b.acknowledgment!.pdfObjectId!, sgo.orgId);
      expect(textB).toContain("Riley Synthetic");
      expect(textB).not.toContain(n1.number);
    });

    it("requires an SGO admin to issue", async () => {
      await insertGift({ orgId: sgo.orgId, donorId: donor });
      const reviewer = await createStaff(sgo.orgId, "reviewer");
      expect((await errorOf(issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, { userId: reviewer }))).code).toBe("forbidden");
      expect((await errorOf(issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 1999, mode: "test" }, SYS))).code).toBe("validation_failed");
    });
  });

  describe("delivery", () => {
    it("goes on paper without an active e-delivery consent: a mailing task with a printable PDF, closed when mailed", async () => {
      await insertGift({ orgId: sgo.orgId, donorId: donor });
      await generateSandboxDonorNumber(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      const ack = (await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS)).acknowledgment!;
      expect(ack).toMatchObject({ delivery: "paper_required", emailId: null, deliveredAt: null });
      expect(await t.db.select().from(schema.emails).where(eq(schema.emails.template, "acknowledgment"))).toHaveLength(0);

      const tasks = await listPaperMailings(sgo.orgId, { mode: "test" }, STAFF(admin));
      expect(tasks).toMatchObject([{ acknowledgment: { id: ack.id }, donor: { fullName: "Avery Synthetic", addressLines: ["100 Synthetic Way", "Austin, TX 78701"] } }]);
      expect(await listPaperMailings(sgo.orgId, { mode: "live" }, STAFF(admin))).toEqual([]);
      const pdf = await downloadAcknowledgmentPdf(sgo.orgId, ack.id, STAFF(admin));
      expect(pdf).toMatchObject({ contentType: "application/pdf", filename: "sandbox-acknowledgment-2027-v1.pdf", sha256: ack.pdfSha256 });
      expect((await listAuditLogs({ action: "acknowledgment.download" })).items).toHaveLength(1);

      const mailed = await markAcknowledgmentMailed(sgo.orgId, ack.id, { note: "Synthetic batch 1" }, { userId: admin });
      expect(mailed).toMatchObject({ deliveredAt: NOW, mailedBy: admin });
      expect(await listPaperMailings(sgo.orgId, { mode: "test" }, STAFF(admin))).toEqual([]);
      expect((await errorOf(markAcknowledgmentMailed(sgo.orgId, "ack_missing", {}, { userId: admin }))).code).toBe("not_found");
      const other = await createTestSgo();
      expect((await errorOf(markAcknowledgmentMailed(other.orgId, ack.id, {}, SYS))).code).toBe("not_found");
      expect((await errorOf(downloadAcknowledgmentPdf(other.orgId, ack.id, STAFF(admin)))).code).toBe("not_found");
    });

    it("refuses to serve a stored PDF that is not the document recorded on the acknowledgment", async () => {
      await insertGift({ orgId: sgo.orgId, donorId: donor });
      await generateSandboxDonorNumber(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      const ack = (await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS)).acknowledgment!;
      // Another (validly stored) object of the same SGO: its own checksum is fine, but it is not this acknowledgment.
      const otherDonor = await insertDonor({ firstName: "Blake", email: "blake@synthetic.example" });
      await insertGift({ orgId: sgo.orgId, donorId: otherDonor });
      await generateSandboxDonorNumber(sgo.orgId, { donorId: otherDonor, taxYear: 2027, mode: "test" }, SYS);
      const otherAck = (await issueAcknowledgment(sgo.orgId, { donorId: otherDonor, taxYear: 2027, mode: "test" }, SYS)).acknowledgment!;
      await t.db.update(schema.acknowledgments).set({ pdfObjectId: otherAck.pdfObjectId }).where(eq(schema.acknowledgments.id, ack.id));
      expect((await errorOf(downloadAcknowledgmentPdf(sgo.orgId, ack.id, STAFF(admin)))).code).toBe("internal");
      expect((await listAuditLogs({ action: "acknowledgment.download" })).items).toHaveLength(0);
    });

    it("switches future versions to paper after the donor withdraws e-delivery", async () => {
      const userId = newId("user");
      await t.db.insert(schema.users).values({ id: userId, email: "avery@synthetic.example" });
      await insertGift({ orgId: sgo.orgId, donorId: donor, designatedCents: 100_000 });
      await insertConsent(sgo.orgId, donor, "avery@synthetic.example");
      await generateSandboxDonorNumber(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      expect((await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS)).acknowledgment?.delivery).toBe("email");

      const stranger = newId("user");
      await t.db.insert(schema.users).values({ id: stranger, email: "stranger@synthetic.example" });
      expect((await errorOf(withdrawEDelivery(sgo.orgId, { donorId: donor, mode: "test" }, { userId: stranger }))).code).toBe("forbidden");
      const { withdrawn } = await withdrawEDelivery(sgo.orgId, { donorId: donor, mode: "test" }, { userId });
      expect(withdrawn).toHaveLength(1);
      expect(withdrawn[0]).toMatchObject({ withdrawnAt: NOW, withdrawnByUserId: userId });
      expect((await withdrawEDelivery(sgo.orgId, { donorId: donor, mode: "test" }, { userId })).withdrawn).toEqual([]);
      expect((await listAuditLogs({ action: "donor_delivery_consent.withdraw" })).items).toHaveLength(1);

      await insertGift({ orgId: sgo.orgId, donorId: donor, designatedCents: 20_000 });
      const v2 = await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      expect(v2.acknowledgment).toMatchObject({ version: 2, delivery: "paper_required", deliveryEmail: null, emailId: null });
      expect(await t.db.select().from(schema.emails).where(eq(schema.emails.template, "acknowledgment"))).toHaveLength(1);
    });

    it("lets SGO staff record a withdrawal received by mail", async () => {
      await insertGift({ orgId: sgo.orgId, donorId: donor });
      await insertConsent(sgo.orgId, donor, "avery@synthetic.example");
      expect((await withdrawEDelivery(sgo.orgId, { donorId: donor, mode: "test", reason: "Letter received" }, { userId: admin })).withdrawn).toHaveLength(1);
    });
  });

  describe("reads", () => {
    it("lets the donor download their own acknowledgment, and nobody else", async () => {
      const userId = newId("user");
      await t.db.insert(schema.users).values({ id: userId, email: "avery@synthetic.example" });
      const stranger = newId("user");
      await t.db.insert(schema.users).values({ id: stranger, email: "stranger@synthetic.example" });
      await insertGift({ orgId: sgo.orgId, donorId: donor });
      await generateSandboxDonorNumber(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      const ack = (await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS)).acknowledgment!;
      const own = await downloadAcknowledgmentForUser(userId, ack.id);
      expect(sha256Hex(own.bytes)).toBe(ack.pdfSha256);
      expect((await errorOf(downloadAcknowledgmentForUser(stranger, ack.id))).code).toBe("not_found");
      expect((await errorOf(downloadAcknowledgmentForUser("usr_unknown", ack.id))).code).toBe("forbidden");
      expect((await listAuditLogs({ action: "acknowledgment.download" })).items[0]).toMatchObject({ actorId: userId, metadata: expect.objectContaining({ by: "donor" }) });
    });

    it("shows one donor's status and every version, audited, and hides donors of other SGOs", async () => {
      await insertGift({ orgId: sgo.orgId, donorId: donor });
      await issueAcknowledgment(sgo.orgId, { donorId: donor, taxYear: 2027, mode: "test" }, SYS);
      const detail = await getDonorAcknowledgments(sgo.orgId, donor, { mode: "test", taxYear: 2027 }, STAFF(admin));
      expect(detail).toMatchObject({ donor: { fullName: "Avery Synthetic" }, status: { action: "generate_sandbox_number" }, versions: [{ status: "blocked" }], donorNumber: null });
      expect((await listAuditLogs({ action: "acknowledgment.read" })).items).toHaveLength(1);
      const other = await createTestSgo();
      expect((await errorOf(getDonorAcknowledgments(other.orgId, donor, { mode: "test", taxYear: 2027 }, STAFF(admin)))).code).toBe("not_found");
      expect((await errorOf(getDonorAcknowledgments(sgo.orgId, donor, { mode: "test", taxYear: 2027 }, undefined as never))).code).toBe("forbidden");
    });
  });

  describe("letter and PDF", () => {
    const snapshot = {
      sgo: { name: "Synthetic Fund", legalName: "Synthetic Fund Inc.", ein: "00-1234567", city: "Austin", state: "TX" },
      donor: { fullName: "Zoë Āvila Łem Synthetic", addressLines: ["1 Synthetic Way", "Austin, TX 78701"] },
      donorNumber: { number: "SYN-1", source: "irs_portal_entered" as const },
      gifts: Array.from({ length: 60 }, (_, i) => ({ donationId: `don_synthetic_${i}`, localDate: "2027-03-10", designatedCents: 1_000, nonDesignatedCents: 0 })),
      copyVersion: "synthetic",
      letterCopyVersion: "synthetic",
    };
    const letter = (issuedAt: Date) =>
      buildLetter({ acknowledgmentId: "ack_synthetic", mode: "live", taxYear: 2027, version: 1, issuedAt, snapshot, totalDesignatedCents: 60_000, totalNonDesignatedCents: 0, goodsOrServices: { provided: false, description: null, valueCents: 0 }, previous: null });

    it("renders deterministic bytes for the same content and issue time", async () => {
      const at = new Date("2028-01-05T16:00:00Z");
      const a = await renderAcknowledgmentPdf(letter(at), at);
      const b = await renderAcknowledgmentPdf(letter(at), at);
      expect(sha256Hex(a)).toBe(sha256Hex(b));
      const later = new Date("2028-01-06T16:00:00Z");
      expect(sha256Hex(await renderAcknowledgmentPdf(letter(later), later))).not.toBe(sha256Hex(a));
    });

    it("flows a long gift list onto further pages, transliterating characters the font lacks", async () => {
      const at = new Date("2028-01-05T16:00:00Z");
      const pdf = await extractPdfText(await renderAcknowledgmentPdf(letter(at), at));
      expect(pdf.pages.length).toBeGreaterThan(1);
      expect(pdf.text).toContain("Zoë Avila ?em Synthetic");
      expect(pdf.text).toContain("Page 2 of");
      expect(pdf.text).toContain("$600.00");
      expect(pdf.info).toMatchObject({ Title: expect.stringContaining("2027") });
    });

    it("pins the letter's structural words (bump LETTER_COPY_VERSION when they change)", () => {
      // Changing any structural word changes this hash: update it together with LETTER_COPY_VERSION.
      expect({ version: LETTER_COPY_VERSION, sha256: LETTER_COPY_SHA256 }).toEqual({ version: "ack-letter.2026-11-18.v1", sha256: "26647c263366010c7c066ac182feb2b090232e298cbb556b218edc9412abbec4" });
      expect(LETTER_COPY.testWatermark).toMatch(/NOT VALID FOR FILING/);
    });
  });
});
