import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CodeBlock, ProvisionalNotice } from "@/components/ui";
import { apiExamples } from "@/server/api";
import { FAMILY_LINK_TTL_DAYS, type ApiVerification, ABANDONED_UPLOAD_RETENTION_DAYS } from "@/server/verifications";
import { C, DocsHeader, DocsSection, Endpoint, FieldTable, RefTable, type FieldRow } from "../_components";

export const metadata: Metadata = { title: "The Verification object" };

/** One row per field of ApiVerification: a missing or extra field does not compile. */
const FIELDS: Record<keyof ApiVerification, { type: string; description: ReactNode }> = {
  id: { type: "string", description: <>Unique id, <C>ver_…</C>.</> },
  object: { type: '"verification"', description: "Always verification." },
  mode: { type: "test | live", description: "The mode of the key that created it." },
  status: { type: "enum", description: <>The outcome: <C>pending</C>, <C>eligible</C>, <C>ineligible</C>, <C>needs_review</C>, <C>expired</C>, <C>canceled</C>. Drive your queue from this.</> },
  stage: { type: "enum", description: <>Progress detail while pending: <C>created</C> → <C>started</C> → <C>consented</C> → <C>household</C> → <C>collecting</C> → <C>submitted</C> → <C>processing</C> → (<C>awaiting_family</C> | <C>in_review</C>) → <C>decided</C>. Informational only.</> },
  method: { type: "direct | categorical | null", description: "Direct: income documents or a data connection. Categorical: a benefit award letter (SNAP, TANF, WIC, Section 8, SSI) dated within the last 12 months. Null until decided." },
  household_size: { type: "integer | null", description: "Household size the limit was looked up for." },
  area: { type: "object | null", description: <>County (<C>county_fips</C>, <C>county_name</C>) and HUD income-limit area (<C>hud_area_code</C>, <C>hud_area_name</C>) used for the limit.</> },
  threshold_usd: { type: "string | null", description: <>The income limit the decision relied on, in dollars (<C>&quot;312000.00&quot;</C>). While provisional, this is the <C>median_product</C> reading.</> },
  threshold_readings: { type: "array", description: <>Every reading of the limit: <C>{"{ id, usd }"}</C> with id <C>median_product</C>, <C>section8_vli</C> (provisional) or <C>irs_published</C>.</> },
  threshold_source: { type: "hud_provisional | irs_published | null", description: "Where the limit came from." },
  threshold_table_version: { type: "string | null", description: "Version of the limit table used." },
  threshold_effective_date: { type: "date | null", description: "Effective date of that table." },
  provisional: { type: "boolean", description: <>True while limits are HUD-derived. <strong>Show it wherever you show the result.</strong></> },
  income_year: { type: "integer | null", description: "The calendar year of income tested (direct method)." },
  award_program: { type: "string | null", description: "The benefit program on the award letter (categorical method)." },
  award_letter_date: { type: "date | null", description: "The award letter's date (categorical method): the 12-month window runs from it." },
  reasons: { type: "array", description: <>Reason codes with a fixed, figure-free sentence each: why it needs review, or why it was decided as it was. Income figures appear only in the evidence files.</> },
  evidence_pack_url: { type: "string | null", description: <>API URL of the evidence PDF. Needs your key. Null until it exists.</> },
  evidence_json_url: { type: "string | null", description: <>API URL of the signed evidence JSON. Needs your key. Null until it exists.</> },
  consent: { type: "object | null", description: <>The family&apos;s sharing consent: <C>version</C> of the exact words and <C>granted_at</C>.</> },
  expires_at: { type: "timestamp | null", description: "When a decided result stops being reusable. Null until decided." },
  decided_at: { type: "timestamp | null", description: "When the decision was made." },
  decided_by: { type: "engine | reviewer | null", description: "Whether the automatic check or a person at your organization decided." },
  passport: { type: "object | null", description: <>Set when an earlier, still-valid result was reused with the family&apos;s fresh consent: <C>{"{ reused: true, source_decided_at }"}</C>.</> },
  external_ref: { type: "string | null", description: "Your own applicant id, as sent." },
  metadata: { type: "object", description: "Your own string key/values, as sent." },
  created_at: { type: "timestamp", description: "When it was created." },
};

const ROWS: FieldRow[] = (Object.keys(FIELDS) as Array<keyof ApiVerification>).map((name) => ({ name, ...FIELDS[name] }));

export default function VerificationObjectPage() {
  return (
    <>
      <DocsHeader
        eyebrow="Reference"
        title="The Verification object"
        lead={
          <p>
            What every verification read, list item and <C>verification.*</C> webhook carries. It never contains names, contact details, documents, income figures or the
            family link — those stay with the family and in the evidence files.
          </p>
        }
      />

      <DocsSection id="endpoints" title="Endpoints">
        <ul className="space-y-2">
          <li><Endpoint method="POST" path="/api/v1/verifications" /></li>
          <li><Endpoint method="GET" path="/api/v1/verifications" /></li>
          <li><Endpoint method="GET" path="/api/v1/verifications/{id}" /></li>
          <li><Endpoint method="POST" path="/api/v1/verifications/{id}/cancel" /></li>
          <li><Endpoint method="GET" path="/api/v1/verifications/{id}/evidence.pdf" /></li>
          <li><Endpoint method="GET" path="/api/v1/verifications/{id}/evidence.json" /></li>
          <li><Endpoint method="GET" path="/api/v1/verifications/export.csv" /></li>
        </ul>
      </DocsSection>

      <DocsSection id="fields" title="Fields">
        <FieldTable rows={ROWS} caption="Fields of the Verification object" />
        <CodeBlock title="A decided verification (synthetic example)" language="json" code={JSON.stringify(apiExamples.EXAMPLE_DECIDED_VERIFICATION, null, 2)} />
      </DocsSection>

      <DocsSection id="status-vs-stage" title="Status vs stage">
        <p>
          <C>status</C> is the answer; <C>stage</C> is where the family is while there is no answer yet. Branch your logic on <C>status</C> only.
        </p>
        <RefTable
          caption="Statuses"
          head={["status", "meaning", "what you do"]}
          rows={[
            ["pending", "No decision yet. See stage for progress; awaiting_family means we asked the family for more.", "Wait for a webhook."],
            ["needs_review", "The automatic check could not decide safely (unreadable document, unclear household, income between the two provisional readings).", "A reviewer at your organization resolves it in the dashboard."],
            ["eligible", "The evidence shows household income at or below the limit, under every reading of it.", "Proceed to your award process. Eligible is not an award."],
            ["ineligible", "The evidence affirmatively shows income over the limit. Missing or unusable evidence is never ineligible.", "Tell the applicant; the reasons say why in plain words."],
            ["expired", "A decided result passed expires_at, or the family never opened the link.", "Create a new verification if needed."],
            ["canceled", "You canceled it before a decision.", "Nothing."],
          ]}
        />
      </DocsSection>

      <DocsSection id="provisional" title="The provisional flag and the two threshold readings">
        <ProvisionalNotice title="Limits are provisional until the IRS publishes its table">
          <p>
            Until then limits are derived from HUD data, <C>threshold_source</C> is <C>hud_provisional</C> and <C>provisional</C> is <C>true</C>. Every surface that shows a result
            — your portal included — should say so.
          </p>
        </ProvisionalNotice>
        <p>
          Under the proposed rules the HUD-derived limit can be read two ways: 300% × the HUD area median × the family-size multiplier (<C>median_product</C>), or 6 × HUD&apos;s
          Section 8 very-low-income limit for the household size (<C>section8_vli</C>). The two differ in many Texas counties. We therefore decide automatically only where both
          readings agree: income at or below the <em>lower</em> reading is eligible, above the <em>higher</em> reading is ineligible, and anything in between goes to{" "}
          <C>needs_review</C> with both figures shown to your reviewer. Both readings are always recorded in <C>threshold_readings</C> and in the evidence. When the IRS table is
          published, results carry a single <C>irs_published</C> reading.
        </p>
      </DocsSection>

      <DocsSection id="expiry" title="What expires when">
        <RefTable
          caption="Expiry and retention"
          head={["what", "when", "then"]}
          rows={[
            ["Family link", `${FAMILY_LINK_TTL_DAYS} days after creation`, "If never opened, the verification becomes expired (verification.expired)."],
            ["Sharing consent", "End of the calendar year after the family consents", "Recorded with its version and timestamp in consent and the evidence."],
            ["Decided result (expires_at)", "Direct method: December 31 of the application year. Categorical: the earliest of that, 12 months after the award letter date, and the benefit period end when one was read.", "status becomes expired; the decision and evidence are kept."],
            ["Raw uploads", "Your organization's retention window after a decision (default 30 days)", `Files are deleted; their hashes stay in the evidence. Uploads of an abandoned application are deleted after ${ABANDONED_UPLOAD_RETENTION_DAYS} days.`],
            ["Evidence files", "Kept", "Download them any time with your key."],
          ]}
        />
        <p>
          A still-valid result can be reused by another SGO only with the family&apos;s fresh consent (<C>passport</C>). See also <Link href="/docs/evidence">evidence packs</Link>.
        </p>
      </DocsSection>
    </>
  );
}
