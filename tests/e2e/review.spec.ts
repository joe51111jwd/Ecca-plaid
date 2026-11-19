/**
 * Human review of a document the reader cannot read. A SYNTHETIC phone photo of a SNAP letter has no text layer, so
 * the engine never guesses: the verification goes to the SGO's review queue, the family is told a person is looking,
 * and the reviewer reads the file, keys its fields and re-runs the check. The timeline keeps the review trail.
 */
import { expect, test } from "@playwright/test";
import {
  SNAP_PHOTO,
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
} from "./helpers";

test("a reviewer resolves an unreadable scan from the review queue", async ({ page, browser }) => {
  await newSgo(page, "Review Scholarship Fund");
  const family = danaSample();
  const ref = `REV-${tag()}`;
  const { familyUrl, verificationId } = await createVerificationInDashboard(page, { applicantName: "Dana Sample", email: family.email, ref });

  const parentContext = await browser.newContext();
  const parent = await parentContext.newPage();
  await familySignIn(parent, familyUrl, family.email);
  await familyDescribesHousehold(parent, family);
  await familyUploads(parent, "Benefits letter", SNAP_PHOTO);
  await familySubmits(parent);
  await drainJobs(parent.request);
  await parent.reload();
  await expect(parent.getByRole("heading", { level: 1, name: "A person is reviewing" })).toBeVisible();

  // In the queue, with the reason in plain words.
  await page.goto("/sgo/review");
  const row = page.getByRole("row", { name: new RegExp(ref) });
  await expect(row).toBeVisible();
  await row.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/sgo/verifications/${verificationId}(#review)?$`));
  await expect(page.getByText("Needs review").first()).toBeVisible();
  await expect(page.getByText("The file is a photo or image; it has no text layer and is read by a person.")).toBeVisible();

  // The reviewer opens the file (audited) and it really is the uploaded PNG.
  await page.getByRole("link", { name: "View file" }).first().click();
  const viewer = page.locator(`[src*="/sgo/verifications/${verificationId}/documents/"]`).first();
  await expect(viewer).toBeVisible();
  const file = await page.request.get((await viewer.getAttribute("src"))!);
  expect(file.ok()).toBeTruthy();
  expect((await file.body()).subarray(1, 4).toString("latin1")).toBe("PNG");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Take the case, key what the photo shows, and let the engine decide again.
  const assign = page.getByRole("form", { name: "Assign the review" });
  await assign.getByLabel("Assigned to").selectOption({ label: "Me" });
  await assign.getByRole("button", { name: "Assign" }).click();
  await expect(assign.getByLabel("Assigned to")).toHaveValue(/.+/);
  await reviewerConfirmsSnapLetter(page, "SYNTHETIC_tf0001_snap_photo.png", { date: "2026-09-15", recipient: "DANA SAMPLE" });
  await expect(page.getByText("Eligible: categorical method")).toBeVisible();

  // The review trail is on the timeline and the case has left the queue.
  const timeline = page.getByRole("list", { name: "Verification history" });
  await expect(timeline.getByText("Sent to a reviewer")).toBeVisible();
  await page.goto("/sgo/review");
  await expect(page.getByRole("row", { name: new RegExp(ref) })).toHaveCount(0);

  await parent.reload();
  await expect(parent.getByRole("heading", { level: 1, name: "You meet the income requirement" })).toBeVisible();
  await parentContext.close();
});

test("asking the family for more keeps the case pending instead of declining it", async ({ page, browser }) => {
  await newSgo(page, "Ask-for-more Scholarship Fund");
  const family = danaSample();
  const ref = `ASK-${tag()}`;
  const { familyUrl, verificationId } = await createVerificationInDashboard(page, { applicantName: "Dana Sample", email: family.email, ref });

  const parentContext = await browser.newContext();
  const parent = await parentContext.newPage();
  await familySignIn(parent, familyUrl, family.email);
  await familyDescribesHousehold(parent, family);
  await familyUploads(parent, "Benefits letter", SNAP_PHOTO);
  await familySubmits(parent);
  await drainJobs(parent.request);

  await page.goto(`/sgo/verifications/${verificationId}`);
  const ask = page.getByRole("region", { name: "Ask the family for more" });
  await ask.getByLabel("Message to the family").fill("The photo is hard to read. Please upload the PDF of the letter.");
  await ask.getByLabel("What to send").fill("The SNAP approval letter as a PDF");
  await ask.getByRole("button", { name: "Send the request" }).click();
  await drainJobs(page.request);
  await page.reload();
  await expect(page.getByText("Not eligible", { exact: true })).toHaveCount(0);

  // The family is told exactly what to send, in the reviewer's words.
  await parent.reload();
  await expect(parent.getByText("The photo is hard to read. Please upload the PDF of the letter.").first()).toBeVisible();
  await expect(parent.getByText("The SNAP approval letter as a PDF").first()).toBeVisible();
  await parentContext.close();
});
