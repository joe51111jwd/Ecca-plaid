/**
 * Tenant isolation between SGOs: SGO B's staff cannot open, download or list SGO A's verification, on the dashboard
 * or through the API with B's own key. Another tenant's row is "not found", never "forbidden" (which would confirm
 * that it exists).
 */
import { expect, test } from "@playwright/test";
import { createTestKey, createVerificationInDashboard, newSgo, tag, uniqueEmail } from "./helpers";

test("SGO B cannot open SGO A's verification", async ({ page, browser, playwright }) => {
  // SGO A creates a verification.
  await newSgo(page, "Tenant A Scholarship Fund");
  const ref = `ISO-${tag()}`;
  const { verificationId } = await createVerificationInDashboard(page, { applicantName: "Dana Sample", email: uniqueEmail("family"), ref });
  await page.goto(`/sgo/verifications/${verificationId}`);
  await expect(page.getByText(`Your reference ${ref}`, { exact: false })).toBeVisible();

  // SGO B, a different organization and person.
  const bContext = await browser.newContext();
  const b = await bContext.newPage();
  await newSgo(b, "Tenant B Scholarship Fund");

  const detail = await b.goto(`/sgo/verifications/${verificationId}`);
  expect(detail?.status()).toBe(404);
  await expect(b.getByRole("heading", { name: "We can’t find that page" })).toBeVisible();
  await expect(b.getByText(ref)).toHaveCount(0);

  for (const kind of ["pdf", "json"]) {
    const res = await b.request.get(`/sgo/verifications/${verificationId}/evidence/${kind}`);
    expect(res.status(), `evidence ${kind}`).toBe(404);
  }

  await b.goto("/sgo/verifications");
  await expect(b.getByText(ref)).toHaveCount(0);
  await b.goto(`/sgo/verifications?q=${ref}`);
  await expect(b.getByText(ref)).toHaveCount(0);

  // B's API key cannot read it either.
  const keyB = await createTestKey(b, `Isolation ${tag()}`);
  const api = await playwright.request.newContext({ baseURL: new URL(b.url()).origin, extraHTTPHeaders: { Authorization: `Bearer ${keyB}` } });
  expect((await api.get(`/api/v1/verifications/${verificationId}`)).status()).toBe(404);
  expect((await api.get(`/api/v1/verifications/${verificationId}/evidence.json`)).status()).toBe(404);
  expect((await api.post(`/api/v1/verifications/${verificationId}/cancel`, { data: {} })).status()).toBe(404);
  const list = (await (await api.get(`/api/v1/verifications?external_ref=${ref}`)).json()) as { data: unknown[] };
  expect(list.data).toEqual([]);
  await api.dispose();
  await bContext.close();

  // A still sees it, untouched.
  await page.reload();
  await expect(page.getByText(`Your reference ${ref}`, { exact: false })).toBeVisible();
});
