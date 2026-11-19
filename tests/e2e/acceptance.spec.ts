/**
 * The build spec's own acceptance test (Build order, step 2): "a fake household can go from magic link to evidence
 * pack". Everything goes through the product's screens: an SGO creates a verification, a parent signs in with an
 * emailed code, consents, describes the household, uploads a SYNTHETIC SNAP approval letter and submits; the SGO's
 * reviewer confirms the letter (the TF0001 layout is unverified, so the engine never says yes alone); the result is
 * eligible and provisional; the SGO downloads the signed evidence JSON, whose signature verifies against the
 * published key set, and the evidence PDF.
 */
import { expect, test } from "@playwright/test";
import { verifySignedEvidence } from "@/engine/evidence/record";
import {
  SNAP_LETTER,
  createVerificationInDashboard,
  danaSample,
  drainJobs,
  familyDescribesHousehold,
  familySignIn,
  familySubmits,
  familyUploads,
  newSgo,
  reviewerConfirmsSnapLetter,
  tag,
  waitForEvidenceLinks,
} from "./helpers";

test("a fake household goes from magic link to a signed evidence pack", async ({ page, browser }) => {
  const sgo = await newSgo(page, "Acceptance Scholarship Fund");
  const family = danaSample();
  const ref = `ACC-${tag()}`;
  const { familyUrl, verificationId } = await createVerificationInDashboard(page, { applicantName: "Dana Sample", email: family.email, ref });

  // The parent, on their own device.
  const parentContext = await browser.newContext();
  const parent = await parentContext.newPage();
  await familySignIn(parent, familyUrl, family.email);
  await familyDescribesHousehold(parent, family);
  await familyUploads(parent, "Benefits letter", SNAP_LETTER);
  await familySubmits(parent);
  await drainJobs(parent.request);
  await parent.reload();
  // An unverified letter layout always goes to a person: the family is told so, and nothing reads as a result yet.
  await expect(parent.getByRole("heading", { level: 1, name: "A person is reviewing" })).toBeVisible();
  await expect(parent.getByText("Being eligible is not a promise of a scholarship.").first()).toBeVisible();

  // The SGO sees it in the review queue, confirms the letter's fields and re-runs the check.
  await page.goto("/sgo/review");
  await expect(page.getByRole("link", { name: new RegExp(ref) })).toBeVisible();
  await page.goto(`/sgo/verifications/${verificationId}`);
  await expect(page.getByText(`Your reference ${ref}`, { exact: false })).toBeVisible();
  await reviewerConfirmsSnapLetter(page, "SYNTHETIC_tf0001_snap_approved.pdf", { date: "2026-09-15", recipient: "DANA SAMPLE" });

  await expect(page.getByText("Eligible: categorical method")).toBeVisible();
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
  const record = signed.record as { decision: { status: string }; categorical: { program: string; letter_date: string } | null };
  expect(record.decision.status).toBe("eligible");
  expect(record.categorical).toMatchObject({ program: "SNAP", letter_date: "2026-09-15" });
  const tampered = JSON.parse(JSON.stringify(signed)) as typeof signed & { record: { decision: { status: string } } };
  tampered.record.decision.status = "ineligible";
  expect(verifySignedEvidence(tampered, jwks)).toMatchObject({ valid: false });

  const pdfRes = await page.request.get(pdfHref);
  expect(pdfRes.ok()).toBeTruthy();
  expect(pdfRes.headers()["content-type"]).toContain("application/pdf");
  expect((await pdfRes.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // The family now sees the outcome, labeled provisional and not an award.
  await parent.reload();
  await expect(parent.getByRole("heading", { level: 1, name: "You meet the income requirement" })).toBeVisible();
  await expect(parent.getByText(/provisional/i).first()).toBeVisible();
  await expect(parent.getByText("Being eligible is not a promise of a scholarship.").first()).toBeVisible();
  await parentContext.close();

  expect(sgo.name).toContain("Acceptance Scholarship Fund");
});
