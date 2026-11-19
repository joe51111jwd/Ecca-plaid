/**
 * Donor checkout before January 1, 2027: a platform admin puts a new (synthetic, 00- EIN) SGO on the provisional list,
 * a donor finds it, sees the tax-math preview and the "not credit-eligible" banner with its reasons, designates the
 * gift with the exact words shown, pays with a sandbox test number, and receives the payment receipt by email, which
 * says plainly that it is not the official acknowledgment. The SGO then sees the gift on its donations page.
 *
 * The credit start date is the real one; this test assumes it runs before it (the suite's ECCA_FAKE_NOW can move
 * the clock, in which case the banner test is skipped rather than lying).
 */
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAIL, latestEmail, signIn, tag, uniqueEmail, createSgoWorkspace } from "./helpers";

const CREDIT_START = Date.parse("2027-01-01T06:00:00Z");
const beforeCreditStart = Date.parse(process.env.ECCA_FAKE_NOW ?? new Date().toISOString()) < CREDIT_START;

/** A random synthetic EIN with the 00- prefix (never assigned by the IRS). */
function syntheticEin(): string {
  return `00-${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
}

async function listOnProvisionalList(admin: Page, sgo: { name: string; ein: string }): Promise<void> {
  await signIn(admin, ADMIN_EMAIL, "/admin/sgo-list");
  await admin.goto("/admin/sgo-list");
  const csv = ["state,name,ein,status,listed_from,removed_on", `TX,${sgo.name},${sgo.ein},listed,2026-11-01,`].join("\n");
  const importForm = admin.getByRole("region", { name: "Import a list file" });
  await importForm.getByLabel("List file", { exact: true }).setInputFiles({ name: "synthetic-list.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await importForm.getByRole("button", { name: "Import list" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Import" }).click();
  const row = admin.getByRole("row", { name: new RegExp(sgo.ein) });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Link…" }).click();
  await admin.getByLabel("Organization").selectOption({ label: `${sgo.name} (${sgo.ein})` });
  await admin.getByRole("button", { name: "Link", exact: true }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Link entry" }).click();
  await expect(admin.getByRole("row", { name: new RegExp(sgo.ein) }).getByRole("link", { name: "Open" })).toBeVisible();
}

test("a donor gives in the sandbox, sees why it is not credit-eligible yet, and gets the receipt email", async ({ page, browser }) => {
  test.skip(!beforeCreditStart, "The not-credit-eligible-yet banner only exists before January 1, 2027.");

  // An SGO signs up, and a platform admin puts it on the provisional list.
  const sgo = { name: `Donor Test Scholarship Fund ${tag()} (synthetic)`, ein: syntheticEin() };
  const ownerEmail = uniqueEmail("sgo-owner");
  await signIn(page, ownerEmail);
  await createSgoWorkspace(page, { name: sgo.name, ein: sgo.ein, city: "Austin" });
  const adminContext = await browser.newContext();
  await listOnProvisionalList(await adminContext.newPage(), sgo);
  await adminContext.close();

  // The donor, signed out, in a fresh browser.
  const donorContext = await browser.newContext();
  const donor = await donorContext.newPage();
  const donorEmail = uniqueEmail("donor");
  await donor.goto("/give");
  await expect(donor.getByText(/is not the IRS list of scholarship granting organizations/).first()).toBeVisible();
  await donor.getByRole("searchbox", { name: "Search by organization name or EIN" }).fill(sgo.ein);
  await donor.getByRole("button", { name: "Search" }).click();
  const result = donor.getByRole("listitem").filter({ has: donor.getByRole("heading", { name: sgo.name }) });
  await expect(result).toBeVisible();
  await expect(result.getByText("Provisional list").first()).toBeVisible();
  await result.getByRole("link", { name: "Give to this organization" }).click();

  // Step 1: the gift, with the tax-math preview beside it.
  await donor.getByLabel("Gift amount").fill("1200");
  await donor.getByRole("button", { name: "Start your gift" }).click();
  const preview = donor.getByTestId("tax-math-panel");
  await expect(preview.getByRole("paragraph").filter({ hasText: /^Sandbox gift, not credit-eligible/ })).toBeVisible();
  await expect(preview.getByText(/applies only to gifts made on or after January 1, 2027/).filter({ visible: true }).first()).toBeVisible();
  await expect(preview.getByText(/It is not tax advice/).filter({ visible: true }).first()).toBeVisible();
  await expect(donor.getByText(/cannot be earmarked for a named student/)).toBeVisible();
  await expect(donor.getByLabel("Amount to designate as a section 25F qualified contribution")).toHaveValue(/^1,?200(\.00)?$/);
  await donor.getByRole("button", { name: "Continue" }).click();

  // Step 2: about you. No SSN or TIN is asked for anywhere.
  await donor.getByRole("radio", { name: "Single" }).check();
  await donor.getByLabel("First name").fill("Avery");
  await donor.getByLabel("Last name").fill("Donorsample");
  // No red while the donor is still typing: a half-typed address is saved as a draft but not flagged until the
  // field is left.
  const emailField = donor.getByLabel("Email address");
  await emailField.pressSequentially("avery@", { delay: 30 });
  await donor.waitForTimeout(1_500);
  await expect(emailField).not.toHaveAttribute("aria-invalid", "true");
  await expect(donor.locator("#give-email-error")).toHaveCount(0);
  await emailField.blur();
  await expect(donor.locator("#give-email-error")).toHaveText("Enter a valid email address.");
  await emailField.fill(donorEmail);
  await donor.getByLabel("Street address").fill("800 Donor Drive");
  await donor.getByLabel("City").fill("Austin");
  await donor.getByRole("combobox", { name: "State", exact: true }).selectOption("TX");
  await donor.getByLabel("ZIP code").fill("78701");
  await expect(donor.getByLabel(/social security|taxpayer identification/i)).toHaveCount(0);
  await donor.getByRole("button", { name: "Continue" }).click();

  // Step 3: attestations, the designation in exact words, e-delivery consent.
  const confirm = donor.getByRole("region", { name: "Confirm your gift" });
  await expect(confirm.getByText(`I designate $1,200 of this payment to ${sgo.name} as a qualified contribution under Internal Revenue Code section 25F.`)).toBeVisible();
  await expect(confirm.getByText("This designation is irrevocable. Once you pay, it cannot be undone or changed.")).toBeVisible();
  for (const box of await confirm.getByRole("checkbox").all()) await box.check();
  await donor.getByRole("button", { name: "Continue" }).click();

  // Step 4: the designated amount and any fee are separate lines; under the default there is no fee.
  const charged = donor.getByRole("region", { name: "What you will be charged" });
  await expect(charged.getByText("Section 25F qualified contribution (designated)")).toBeVisible();
  await expect(charged.getByText(/does not take a fee out of this gift or add one to it/)).toBeVisible();
  await donor.getByRole("button", { name: "Continue to payment" }).click();
  await donor.getByRole("button", { name: /Use test number 4242 4242 4242 4242:/ }).click();
  await donor.getByLabel("Expiry date").fill("12/30");
  await donor.getByLabel("Security code").fill("123");
  await donor.getByRole("button", { name: "Complete sandbox gift" }).click();

  // The receipt page and the receipt email: not the acknowledgment, not credit-eligible, and why.
  await donor.waitForURL(/\/thanks\?/);
  await expect(donor.getByRole("heading", { level: 1, name: `Receipt for your gift to ${sgo.name}` })).toBeVisible();
  await expect(donor.getByText(/This is a payment receipt, not the official written acknowledgment/)).toBeVisible();
  await expect(donor.getByText(/Not credit-eligible yet: the federal credit applies only to gifts made on or after January 1, 2027/)).toBeVisible();
  const mail = await latestEmail(donor.request, donorEmail, "donation_receipt");
  expect(mail.subject).toBe(`[Sandbox] Payment receipt for your gift to ${sgo.name}`);
  expect(mail.text).toContain("This is a payment receipt, not the official written acknowledgment");
  expect(mail.text).toContain("This designation is irrevocable.");
  expect(mail.text).toContain("Not credit-eligible yet");
  // The receipt is readable in the development mailbox too.
  await donor.goto("/dev/mail");
  await expect(donor.getByText(mail.subject).first()).toBeVisible();
  await donorContext.close();

  // The SGO sees the gift.
  await page.goto("/sgo/donations");
  await expect(page.getByText("Avery Donorsample").first()).toBeVisible();
});
