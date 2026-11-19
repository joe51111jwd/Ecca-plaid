/**
 * The build spec's own acceptance test (Build order, step 2): "a fake household can go from magic link to evidence
 * pack". Everything goes through the product's screens: an SGO creates a verification, a parent signs in with an
 * emailed code, consents, describes the household, uploads a SYNTHETIC text-layer W-2 PDF, signs that there was no other
 * income and submits. The engine
 * reads the W-2 and decides on its own (the income is under both readings of the limit), so the family sees the
 * result at once, labeled provisional and not an award. The SGO sees a case decided automatically and downloads
 * the signed evidence JSON, whose signature verifies against the published key set, and the evidence PDF.
 * (A letter a reviewer confirms by hand is covered in review.spec.ts and handoff.spec.ts.)
 */
import { expect, test } from "@playwright/test";
import { verifySignedEvidence } from "@/engine/evidence/record";
import {
  W2_PDF,
  createVerificationInDashboard,
  danaSample,
  drainJobs,
  familyDescribesHousehold,
  familySignIn,
  familySignsNoOtherIncome,
  familySubmits,
  familyUploads,
  newSgo,
  tag,
  waitForEvidenceLinks,
} from "./helpers";

test("a fake household goes from magic link to an automatic decision and a signed evidence pack", async ({ page, browser }) => {
  const sgo = await newSgo(page, "Acceptance Scholarship Fund");
  const family = danaSample();
  const ref = `ACC-${tag()}`;
  const { familyUrl, verificationId } = await createVerificationInDashboard(page, { applicantName: "Dana Sample", email: family.email, ref });

  // The parent, on their own device.
  const parentContext = await browser.newContext();
  const parent = await parentContext.newPage();
  await familySignIn(parent, familyUrl, family.email);
  await familyDescribesHousehold(parent, family);
  await familyUploads(parent, "W-2 form", W2_PDF);
  // The upload is read in the running app: it ends as "Received", never "We could not read this" for a clean
  // text-layer PDF. (The upload screen refreshes itself while a document is being read.)
  const documents = parent.getByRole("region", { name: "Your documents" });
  await expect(documents.getByText("Received", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(parent.getByText(/We could not read this/)).toHaveCount(0);
  // A W-2 shows wages only, so the parent also signs that there was no other income.
  await familySignsNoOtherIncome(parent);
  await familySubmits(parent);

  // The engine decides on its own; the family sees the outcome without waiting for a person.
  await expect(async () => {
    await drainJobs(parent.request);
    await parent.reload();
    await expect(parent.getByRole("heading", { level: 1, name: "You meet the income requirement" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  await expect(parent.getByText(/provisional/i).first()).toBeVisible();
  await expect(parent.getByText("Being eligible is not a promise of a scholarship.").first()).toBeVisible();
  await parentContext.close();

  // The SGO sees a decided case: nothing in the review queue, decided automatically, limit provisional.
  await page.goto("/sgo/review");
  await expect(page.getByRole("link", { name: new RegExp(ref) })).toHaveCount(0);
  await page.goto(`/sgo/verifications/${verificationId}`);
  await expect(page.getByText(`Your reference ${ref}`, { exact: false })).toBeVisible();
  await expect(page.getByText(/Decided automatically/).first()).toBeVisible();
  await expect(page.getByRole("region", { name: /The limit used Provisional/ })).toBeVisible();
  await expect(page.getByText("This income limit is provisional").first()).toBeVisible();
  // Both readings of the limit are recorded and shown.
  await expect(page.getByRole("table", { name: "Readings of the limit" }).getByRole("row")).toHaveCount(3);

  // Evidence: the signed JSON verifies against the published keys; a tampered copy does not.
  const { pdf: pdfHref, json: jsonHref } = await waitForEvidenceLinks(page);
  const jsonRes = await page.request.get(jsonHref);
  expect(jsonRes.ok()).toBeTruthy();
  const signed = (await jsonRes.json()) as Parameters<typeof verifySignedEvidence>[0] & { record: Record<string, unknown> };
  const jwks = await (await page.request.get("/.well-known/jwks.json")).json();
  expect(verifySignedEvidence(signed, jwks)).toMatchObject({ valid: true });
  const record = signed.record as { decision: { status: string } };
  expect(record.decision.status).toBe("eligible");
  const tampered = JSON.parse(JSON.stringify(signed)) as typeof signed & { record: { decision: { status: string } } };
  tampered.record.decision.status = "ineligible";
  expect(verifySignedEvidence(tampered, jwks)).toMatchObject({ valid: false });

  const pdfRes = await page.request.get(pdfHref);
  expect(pdfRes.ok()).toBeTruthy();
  expect(pdfRes.headers()["content-type"]).toContain("application/pdf");
  expect((await pdfRes.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  expect(sgo.name).toContain("Acceptance Scholarship Fund");
});
