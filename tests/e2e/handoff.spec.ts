/**
 * The point-of-booking handoff, end to end on the fictional demo camp (/demo/camp): a family presses "Pay with a
 * scholarship" at checkout, the camp's reservation is held for a stated window, the family verifies with the camp's
 * partner SGO and submits a SYNTHETIC SNAP letter, the camp's portal shows the spot held, the SGO's reviewer confirms
 * the letter and the SGO offers an award, and the camp's portal shows "Awarded". The family never sees a fee.
 */
import { expect, test } from "@playwright/test";
import { DEMO_CAMP, DEMO_SGO } from "@/features/handoff/demo";
import {
  SNAP_LETTER,
  danaSample,
  drainJobs,
  familyDescribesHousehold,
  familySignIn,
  familySubmits,
  familyUploads,
  reviewerConfirmsSnapLetter,
  signIn,
} from "./helpers";

/** Who staffs the camp's partner SGO: the demo camp's own partner, or the seeded Lone Star fund on a seeded server. */
const PARTNER_STAFF: Record<string, string> = {
  [DEMO_SGO.name]: DEMO_SGO.ownerEmail,
  "Demo: Lone Star Scholarship Fund (sandbox)": "director@lonestar-fund.passport.test",
};

/**
 * A submitted-but-undecided verification reaches the camp through the recurring "handoff.sync_progress" job, which
 * runs every SYNC_PROGRESS_EVERY_MS (5 minutes, src/server/handoffs/policy.ts); decisions arrive at once. So the wait
 * for "Spot held" can legitimately take that long.
 */
const HELD_SYNC_WAIT_MS = 6 * 60_000;

test("camp checkout → spot held → SGO award → the camp sees it awarded", async ({ page, browser }) => {
  test.setTimeout(HELD_SYNC_WAIT_MS + 4 * 60_000);
  const family = danaSample();

  // The family at the camp's checkout.
  await page.goto("/demo/camp");
  const setup = page.getByRole("button", { name: "Set up the demo camp" });
  if (await setup.isVisible()) {
    await setup.click();
    await expect(page.getByRole("link", { name: "Book this session" }).first()).toBeVisible();
  }
  await page.getByRole("link", { name: "Book this session" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  const bookingRef = (await page.getByRole("definition").first().textContent())?.trim() ?? "";
  expect(bookingRef).toMatch(/^CCC-/);
  await page.getByRole("button", { name: "Pay with a scholarship" }).click();

  // The family handoff page: the hold deadline, free for families, no promise of an award.
  await page.waitForURL(/\/h\/[A-Za-z0-9_-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Check whether your household may qualify" })).toBeVisible();
  await expect(page.getByText(/We'll hold your spot until /)).toBeVisible();
  await expect(page.getByText(bookingRef)).toBeVisible();
  await expect(page.getByText(/Families never pay to verify/)).toBeVisible();
  await expect(page.getByText(/Verifying your income does not guarantee a scholarship/)).toBeVisible();
  const partnerName = (await page.getByText(/^A partner scholarship organization, .+, can check if you qualify\.$/).textContent())!.replace(/^A partner scholarship organization, (.+), can check if you qualify\.$/, "$1");
  const staffEmail = PARTNER_STAFF[partnerName];
  expect(staffEmail, `a known staff address for ${partnerName}`).toBeTruthy();
  const handoffUrl = page.url();
  const verifyHref = await page.getByRole("link", { name: "Check if I qualify" }).getAttribute("href");
  expect(verifyHref).toMatch(/\/v\//);

  await familySignIn(page, new URL(verifyHref!, handoffUrl).toString(), family.email);
  await familyDescribesHousehold(page, family);
  await familyUploads(page, "Benefits letter", SNAP_LETTER);
  await familySubmits(page);
  await drainJobs(page.request);

  // The camp's portal: the booking is held, never with any family data beyond the booking.
  const campContext = await browser.newContext();
  const camp = await campContext.newPage();
  await signIn(camp, DEMO_CAMP.ownerEmail, "/partner/handoffs");
  const campRow = () => camp.getByRole("row", { name: new RegExp(bookingRef) });
  await expect(async () => {
    await drainJobs(camp.request);
    await camp.goto("/partner/handoffs");
    await expect(campRow()).toContainText("Spot held", { timeout: 2_000 });
  }).toPass({ timeout: HELD_SYNC_WAIT_MS, intervals: [3_000] });
  await expect(campRow()).not.toContainText(/Sample|SNAP/);

  // The family's handoff page says the spot is held.
  await page.goto(handoffUrl);
  await expect(page.getByText(/hold/i).first()).toBeVisible();

  // The SGO: confirm the letter, then offer an award (its own explicit decision).
  const sgoContext = await browser.newContext();
  const sgo = await sgoContext.newPage();
  await signIn(sgo, staffEmail!, "/sgo/review");
  await sgo.goto("/sgo/verifications");
  await sgo.getByRole("table").getByRole("link").first().click();
  await expect(sgo.getByText("Needs review").first()).toBeVisible();
  await reviewerConfirmsSnapLetter(sgo, "SYNTHETIC_tf0001_snap_approved.pdf", { date: "2026-09-15", recipient: "DANA SAMPLE" });
  await expect(sgo.getByText("Eligible: categorical method")).toBeVisible();
  await expect(sgo.getByText("An award is your organization's own decision; verifying income does not award a scholarship.")).toBeVisible();
  await sgo.getByLabel("Amount (USD)").last().fill("425");
  await sgo.getByLabel("How it will be paid").selectOption({ label: "Paid directly to the school or vendor" });
  await sgo.getByRole("checkbox", { name: /I have read the compliance reminders/ }).check();
  await sgo.getByRole("button", { name: "Offer award" }).click();
  await sgo.getByRole("dialog").getByRole("button", { name: "Offer award" }).click();
  await expect(sgo.getByRole("dialog")).toHaveCount(0);
  await drainJobs(sgo.request);

  await expect(async () => {
    await drainJobs(camp.request);
    await camp.goto("/partner/handoffs");
    await expect(campRow()).toContainText("Awarded", { timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  await campRow().getByRole("link", { name: bookingRef }).click();
  await expect(camp.getByText(/The SGO offered a scholarship award for this booking/).first()).toBeVisible();

  await campContext.close();
  await sgoContext.close();
});
