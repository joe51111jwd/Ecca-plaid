/**
 * Shared steps for the end-to-end suite. Every person, organization, address and document used here is SYNTHETIC
 * (reserved .test addresses, fixtures from tests/fixtures/synthetic, EINs with the 00- prefix the IRS does not
 * assign).
 *
 * The suite runs against a dev server on a throwaway embedded database (playwright.config.ts). Nothing is seeded:
 * each test creates what it needs through the product's own screens and API, with unique names and addresses, so
 * tests do not depend on each other or on their order.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

export const FIXTURES = join(process.cwd(), "tests", "fixtures", "synthetic");
export const fixture = (file: string): string => join(FIXTURES, file);

/** SYNTHETIC documents (see tests/fixtures/synthetic/manifest.json). All name the synthetic "Dana Sample". */
export const SNAP_LETTER = fixture("SYNTHETIC_tf0001_snap_approved.pdf");
export const SNAP_PHOTO = fixture("SYNTHETIC_tf0001_snap_photo.png");
export const W2_PDF = fixture("SYNTHETIC_w2_2025_copyB.pdf");

/** The platform admin granted on first sign-in by PLATFORM_ADMIN_EMAILS in playwright.config.ts. */
export const ADMIN_EMAIL = "admin@passport.test";

/** A short random tag so names and addresses never collide across tests or runs against a reused server. */
export function tag(): string {
  return randomBytes(4).toString("hex");
}

export function uniqueEmail(role: string): string {
  return `${role}.${tag()}@passport.test`;
}

interface OutboxEmail {
  id: string;
  to: string;
  subject: string;
  template: string | null;
  text: string;
  links: string[];
  createdAt: string;
}

/** The newest email recorded for `to` (optionally of one template), polled until it appears. */
export async function latestEmail(request: APIRequestContext, to: string, template?: string, after?: Date): Promise<OutboxEmail> {
  let found: OutboxEmail | null = null;
  await expect
    .poll(
      async () => {
        const q = new URLSearchParams({ to, ...(template ? { template } : {}) });
        const res = await request.get(`/dev/mail/latest?${q.toString()}`);
        if (!res.ok()) return null;
        const mail = (await res.json()) as OutboxEmail;
        if (after && Date.parse(mail.createdAt) < after.getTime()) return null;
        found = mail;
        return mail.id;
      },
      { message: `an email to ${to}${template ? ` (${template})` : ""}`, timeout: 15_000 },
    )
    .not.toBeNull();
  return found!;
}

/** The 6-digit sign-in code from the newest sign-in email to `to`. */
export async function signInCode(request: APIRequestContext, to: string, after: Date): Promise<string> {
  const mail = await latestEmail(request, to, "magic_link", after);
  const code = /\b(\d{6})\b/.exec(mail.text)?.[1];
  expect(code, "the sign-in email carries a 6-digit code").toBeTruthy();
  return code!;
}

/** Types a 6-digit code into the split code field (the field spreads a pasted code over its six boxes). */
async function enterCode(page: Page, code: string): Promise<void> {
  await page.getByLabel("Digit 1 of 6").fill(code);
  const button = page.getByRole("button", { name: "Sign in", exact: true });
  // The form submits by itself once six digits are in; press the button only if it is still there.
  await button.click({ timeout: 3_000 }).catch(() => undefined);
}

/**
 * Fills the email field and asks for a code, until the "Check your email" confirmation shows. A dev server compiling
 * a route for the first time can reload the page under the test, so the step is retried while the form is still
 * there (never once the confirmation is up, so no second email is requested).
 */
async function requestCode(page: Page, fieldLabel: string, buttonName: string, email: string): Promise<void> {
  const confirmation = page.getByText("Check your email");
  await expect(async () => {
    if (await confirmation.isVisible()) return;
    await page.waitForLoadState("networkidle");
    await page.getByLabel(fieldLabel).fill(email);
    await page.getByRole("button", { name: buttonName }).click();
    await expect(confirmation).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

/** Signs in on /sign-in with an emailed code. Returns once the browser has left the sign-in page. */
export async function signIn(page: Page, email: string, next?: string): Promise<void> {
  const since = new Date(Date.now() - 1_000);
  await page.goto(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  await requestCode(page, "Email address", "Email me a sign-in link", email);
  await enterCode(page, await signInCode(page.request, email, since));
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}

/** Runs the job queue until nothing is due (the dev server also runs jobs inline; this just does not wait for it). */
export async function drainJobs(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/internal/jobs/run?drain=1");
  expect(res.ok(), `job runner: ${res.status()}`).toBeTruthy();
}

/** Creates an SGO workspace for a freshly signed-in person via /sgo/signup. */
export async function createSgoWorkspace(page: Page, opts: { name: string; ein?: string; city?: string }): Promise<void> {
  await page.goto("/sgo/signup");
  await page.getByLabel("Organization name").fill(opts.name);
  if (opts.ein) await page.getByLabel("EIN(optional)").fill(opts.ein);
  if (opts.city) await page.getByLabel("City(optional)").fill(opts.city);
  await page.getByRole("combobox", { name: "State" }).selectOption("TX");
  await page.getByRole("checkbox", { name: /I understand the workspace starts in test mode/ }).check();
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/sgo") && !url.pathname.startsWith("/sgo/signup"));
}

/** A new SGO, owned by a new person who is left signed in on `page`. */
export async function newSgo(page: Page, label = "E2E Scholarship Fund"): Promise<{ ownerEmail: string; name: string }> {
  const ownerEmail = uniqueEmail("sgo-owner");
  const name = `${label} ${tag()} (synthetic)`;
  await signIn(page, ownerEmail);
  await createSgoWorkspace(page, { name });
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { ownerEmail, name };
}

/** Creates a verification on /sgo/verifications/new and returns the family link and the verification id. */
export async function createVerificationInDashboard(page: Page, opts: { applicantName: string; email: string; ref: string }): Promise<{ familyUrl: string; verificationId: string }> {
  await page.goto("/sgo/verifications/new");
  await page.getByLabel("Applicant name(optional)").fill(opts.applicantName);
  await page.getByLabel("Family's email(optional)").fill(opts.email);
  await page.getByLabel("Your reference(optional)").fill(opts.ref);
  await page.getByRole("button", { name: "Create verification" }).click();
  const created = page.getByRole("status").filter({ hasText: "Verification created" });
  await expect(created).toBeVisible();
  const familyUrl = (await created.locator("code").first().textContent())?.trim() ?? "";
  expect(familyUrl).toMatch(/\/v\/[A-Za-z0-9_-]{20,}$/);
  const href = await created.getByRole("link", { name: "Open the verification" }).getAttribute("href");
  const verificationId = href?.split("/").pop() ?? "";
  expect(verificationId).toMatch(/^ver_/);
  return { familyUrl, verificationId };
}

export interface SyntheticFamily {
  email: string;
  firstName: string;
  lastName: string;
  studentFirstName: string;
  address: { line1: string; city: string; zip: string };
}

/** The synthetic household the fixture documents name (Dana Sample, Harris County). */
export function danaSample(email = uniqueEmail("family")): SyntheticFamily {
  return { email, firstName: "Dana", lastName: "Sample", studentFirstName: "Riley", address: { line1: "100 Fixture Lane", city: "Houston", zip: "77002" } };
}

/** On a family link's start page: email → code → signed in (lands on the permission screen). */
export async function familySignIn(page: Page, familyUrl: string, email: string): Promise<void> {
  const since = new Date(Date.now() - 1_000);
  await page.goto(familyUrl);
  await requestCode(page, "Your email address", "Email me a code", email);
  await enterCode(page, await signInCode(page.request, email, since));
  await page.waitForURL(/\/consent$/);
}

/** Permission, address, people and custody: everything before proof of income. Ends on the upload screen. */
export async function familyDescribesHousehold(page: Page, family: SyntheticFamily): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: "Your permission" })).toBeVisible();
  await page.getByRole("checkbox", { name: /I am the adult in charge of this household/ }).check();
  await page.getByRole("button", { name: "Give permission and continue" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Where do you live?" })).toBeVisible();
  await page.getByLabel("Street address").fill(family.address.line1);
  await page.getByLabel("City").fill(family.address.city);
  await page.getByLabel("ZIP code").fill(family.address.zip);
  await page.getByRole("button", { name: "Save address" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "First, tell us about you" })).toBeVisible();
  await page.getByLabel("First name").fill(family.firstName);
  await page.getByLabel("Last name").fill(family.lastName);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Who lives with your student?" })).toBeVisible();
  await page.getByRole("link", { name: "Add a person" }).click();
  await page.getByLabel("First name").fill(family.studentFirstName);
  await page.getByLabel("Last name").fill(family.lastName);
  await page.getByRole("radio", { name: /^Student applying for the scholarship/ }).check();
  await page.getByRole("button", { name: "Save person" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 people live in your home." })).toBeVisible();
  await page.getByRole("link", { name: "Everyone is listed" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Where does your student live?" })).toBeVisible();
  await page.getByRole("radio", { name: "No, only in my home" }).check();
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "How do you want to show your income?" })).toBeVisible();
  await page.getByRole("radio", { name: /^Upload documents/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Upload your documents" })).toBeVisible();
}

export type UploadKind = "Benefits letter" | "W-2 form" | "Tax return" | "Pay stub";

/** Uploads one file under the chosen document type and waits until it is listed under "Your documents". */
export async function familyUploads(page: Page, kind: UploadKind, file: string): Promise<void> {
  await page.getByRole("radio", { name: new RegExp(`^${kind}`) }).check();
  await page.getByLabel("Choose files").setInputFiles(file);
  const name = file.split("/").pop()!;
  await expect(page.getByRole("region", { name: "Your documents" }).getByRole("button", { name: `Remove ${name}` })).toBeVisible();
}

/** On the upload screen: signs the statement that the household had no other income, and returns to the upload screen. */
export async function familySignsNoOtherIncome(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Sign a statement of no other income" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign a statement" })).toBeVisible();
  await page.getByRole("checkbox", { name: "I have read this statement. It is true and complete." }).check();
  await page.getByRole("button", { name: "Sign statement" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Upload your documents" })).toBeVisible();
}

/** Review and send; ends on the family's status screen. */
export async function familySubmits(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Review and send" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Review and send" })).toBeVisible();
  await page.getByRole("button", { name: "Send for checking" }).click();
  await page.waitForURL(/\/status$/);
}

/** The keying form for one uploaded file on the SGO's verification page (opened if collapsed). */
export async function keyingForm(page: Page, filename: string): Promise<Locator> {
  const form = page.getByRole("form", { name: `Key fields for ${filename}` });
  if (!(await form.isVisible())) await page.getByText("Key or correct the fields").first().click();
  await expect(form).toBeVisible();
  return form;
}

/** A reviewer confirms a SNAP approval letter's fields (unverified layouts always need a person), then re-runs. */
export async function reviewerConfirmsSnapLetter(page: Page, filename: string, letter: { date: string; recipient: string; member?: string }): Promise<void> {
  const form = await keyingForm(page, filename);
  await form.getByLabel("What this document is").selectOption({ label: "Benefits award letter" });
  // The reviewer says whose letter it is: the person must be on the household roster (proposed rules).
  await form.getByLabel("Whose document(optional)").selectOption({ label: letter.member ?? "Dana Sample" });
  await form.getByLabel("Program").selectOption({ label: "SNAP" });
  await form.getByLabel("Letter date(optional)").fill(letter.date);
  await form.getByLabel("What the letter shows").selectOption({ label: "Approved" });
  await form.getByLabel("Recipient as printed(optional)").fill(letter.recipient);
  await form.getByLabel("Issuing agency(optional)").fill("Texas Health and Human Services Commission");
  await form.getByLabel("Why you keyed or corrected these fields(optional)").fill("Checked the synthetic notice: SNAP approved, dated within 12 months.");
  await form.getByRole("button", { name: "Save keyed fields" }).click();
  await expect(page.getByText(/Saved \d+ keyed fields?\. Re-run the check to use them\./)).toBeVisible();
  await rerunCheck(page);
}

/** Presses "Re-run the check" and waits for the page to show a decided status. */
export async function rerunCheck(page: Page): Promise<void> {
  await page.getByRole("region", { name: "Re-run the check" }).getByRole("button", { name: "Re-run the check" }).click();
  await drainJobs(page.request);
  await page.reload();
}

/** The decision block's status text on the SGO verification page. */
export function decisionSection(page: Page): Locator {
  return page.locator("main");
}

/** Evidence is generated by a job after the decision: drains the queue and reloads until the pack links appear. */
export async function waitForEvidenceLinks(page: Page): Promise<{ pdf: string; json: string }> {
  const json = page.getByRole("link", { name: "Signed JSON" });
  await expect(async () => {
    await drainJobs(page.request);
    await page.reload();
    await expect(json).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  const pdf = await page.getByRole("link", { name: "PDF", exact: true }).getAttribute("href");
  return { pdf: pdf!, json: (await json.getAttribute("href"))! };
}

/** Creates a test-mode key on /sgo/developers and returns the secret shown once. */
export async function createTestKey(page: Page, name: string): Promise<string> {
  await page.goto("/sgo/developers");
  await page.getByLabel("Key name").fill(name);
  await page.getByRole("button", { name: "Create test key" }).click();
  await page.getByRole("button", { name: "Show Secret key" }).click();
  const key = (await page.locator('code[aria-label="Secret key"]').textContent())?.trim() ?? "";
  expect(key).toMatch(/^ecca_test_/);
  return key;
}
