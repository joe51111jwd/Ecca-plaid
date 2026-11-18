import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RailConnect, type RailConnectProps } from "./RailConnect";
import type { RailConnectionView, RailConnectStrings } from "./types";

// SYNTHETIC strings and views. Server rendering covers the initial state of each phase; transitions are
// covered by state.test.ts.

const strings: RailConnectStrings = {
  heading: "Connect your pay records",
  intro: "Let a payroll service send your records.",
  connectButton: "Connect my account",
  connecting: "Opening…",
  uploadInstead: "Upload documents instead",
  sandboxHeading: "Simulated payroll provider — sandbox",
  sandboxExplanation: "No real account is used.",
  sandboxBadge: "Sandbox",
  choosePersona: "Pick a test scenario",
  continueButton: "Continue",
  declineButton: "I don't want to connect",
  plaidOpenButton: "Open Plaid",
  plaidLoading: "Loading…",
  plaidLoadFailed: "Plaid could not load.",
  waitingTitle: "Getting your records",
  waitingBody: "This can take a few minutes.",
  readyTitle: "Records received",
  readyBody: "We have what we need from this account.",
  readyNeedsUpload: "We could not count these records on their own. Please also upload documents.",
  failedTitle: "That did not work",
  declinedTitle: "You chose not to connect",
  revokedTitle: "Disconnected",
  tryAgain: "Try again",
  errorGeneric: "Something went wrong.",
  consentRequired: "Tick the box to continue.",
  retrievedCaption: "What we received",
  sourceTypeLabels: { w2: "Form W-2", final_paystub_ytd: "Last pay stub of the year", paystub_projection: "Mid-year pay stub", bank_income_estimate: "Bank deposits" },
  countedLabel: "Counts",
  notCountedLabel: "Reviewed by a person",
};

function view(over: Partial<RailConnectionView>): RailConnectionView {
  return {
    id: "rail_1",
    verificationId: "ver_1",
    memberId: "hm_1",
    provider: "simulated",
    providerName: "Simulated payroll provider — sandbox",
    kind: "payroll",
    status: "ready",
    sandbox: true,
    failureReason: null,
    failureMessage: null,
    reportSha256: "a".repeat(64),
    retrieved: null,
    waiting: false,
    offerUpload: false,
    createdAt: "2026-11-18T15:00:00.000Z",
    updatedAt: "2026-11-18T15:00:00.000Z",
    ...over,
  };
}

function render(over: Partial<RailConnectProps> = {}): string {
  const props: RailConnectProps = {
    locale: "en",
    strings,
    consent: { title: "Connect through the sandbox", paragraphs: ["Paragraph one.", "Paragraph two."], checkboxLabel: "I agree to connect.", sha256: "b".repeat(64) },
    actions: { start: vi.fn(), complete: vi.fn(), decline: vi.fn(), refresh: vi.fn() },
    onUploadInstead: vi.fn(),
    ...over,
  };
  return renderToStaticMarkup(createElement(RailConnect, props));
}

describe("<RailConnect>", () => {
  it("shows the consent words, the checkbox and the upload escape hatch before anything else", () => {
    const html = render();
    expect(html).toContain("Connect your pay records");
    expect(html).toContain("Paragraph one.");
    expect(html).toContain("I agree to connect.");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Connect my account");
    expect(html).toContain("Upload documents instead");
    expect(html).toContain('data-testid="rail-upload-instead"');
    expect(html).not.toMatch(/password/i);
  });

  it("shows the waiting state for a connection still syncing, with the escape hatch", () => {
    const html = render({ initialConnection: view({ status: "syncing", waiting: true, reportSha256: null }) });
    expect(html).toContain("Getting your records");
    expect(html).toContain('role="status"');
    expect(html).toContain("Upload documents instead");
  });

  it("shows a success with the retrieved records, counted and not", () => {
    const html = render({
      initialConnection: view({
        retrieved: {
          incomeYear: 2025,
          coverage: { incomeYearCovered: true, partialYear: false },
          sources: [
            { type: "w2", employerName: "Synthetic Grocery Co. (sandbox)", taxYear: 2025, grossAnnualCents: 4_125_000, counted: true },
            { type: "paystub_projection", employerName: null, taxYear: 2025, grossAnnualCents: 100_000, counted: false },
          ],
        },
      }),
    });
    expect(html).toContain('data-testid="rail-outcome-ready"');
    expect(html).toContain("We have what we need from this account.");
    expect(html).toContain("Synthetic Grocery Co. (sandbox)");
    expect(html).toContain("$41,250");
    expect(html).toContain("Counts");
    expect(html).toContain("Reviewed by a person");
  });

  it("makes upload the primary action after a failure, with the plain reason in the family's language", () => {
    const failed = view({ status: "failed", failureReason: "provider_unavailable", offerUpload: true, failureMessage: { en: "The service is not answering.", es: "El servicio no responde." } });
    const en = render({ initialConnection: failed });
    expect(en).toContain('data-testid="rail-outcome-failed"');
    expect(en).toContain("The service is not answering.");
    expect(en).toContain("Try again");
    expect(en).toContain('role="alert"');
    const es = render({ initialConnection: failed, locale: "es" });
    expect(es).toContain("El servicio no responde.");
  });

  it("asks for documents when records came back but nothing can count", () => {
    const html = render({ initialConnection: view({ offerUpload: true }) });
    expect(html).toContain("Please also upload documents.");
  });

  it("shows declined and revoked outcomes", () => {
    expect(render({ initialConnection: view({ status: "declined", offerUpload: true, failureMessage: { en: "You chose not to connect.", es: "x" } }) })).toContain("You chose not to connect");
    expect(render({ initialConnection: view({ status: "revoked", offerUpload: true }) })).toContain("Disconnected");
  });
});
