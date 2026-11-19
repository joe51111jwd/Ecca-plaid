import type { Metadata } from "next";
import { Callout, CodeBlock } from "@/components/ui";
import { EVIDENCE_VERIFY_COMMAND, EVIDENCE_VERIFY_OFFLINE_COMMAND, HTTP_SAMPLES, SAMPLE_HOST } from "@/server/api";
import { C, DocsHeader, DocsSection, RefTable, Sample } from "../_components";

export const metadata: Metadata = { title: "Evidence packs" };

const SIGNED_SHAPE = `{
  "record": {
    "schema_version": "1",
    "record_type": "income_verification_evidence",
    "verification_id": "ver_…",
    "mode": "test",
    "sgo": { "id": "org_…", "name": "…", "ein": "…", "external_ref": "APP-1042" },
    "decision": { "status": "eligible", "method": "direct", "summary": "…", "reasons": [ … ], "decided_by": { … }, "expires_at": "…" },
    "household": { "size": 4, "students": [ … ], "members": [ … ] },
    "geography": { "county_fips": "…", "area_code": "…", "zip": "…" },
    "threshold": { "limit_cents": …, "source": "hud_provisional", "provisional": true, "readings": [ … ], "relied_on_statement": "…" },
    "income": { … } | null,
    "categorical": { … } | null,
    "documents": [ { "sha256": "…", … } ],
    "rails": [ … ],
    "consent": { "version": "verification_share.v1", "granted_at": "…", … },
    "review_trail": [ … ],
    "timeline": [ … ],
    "data_minimization": { … },
    "versions": { … }
  },
  "signature": {
    "alg": "EdDSA",
    "kid": "ed25519-…",
    "canonicalization": "ecca-jcs-1",
    "record_sha256": "…",
    "value": "…"
  }
}`;

export default function EvidencePage() {
  return (
    <>
      <DocsHeader
        eyebrow="Evidence"
        title="Files an auditor can check"
        lead={
          <p>
            Every decided verification produces two files: a human-readable evidence pack (PDF) and a signed JSON record of the same facts. Download them with your key; every
            download is written to your organization&apos;s audit log.
          </p>
        }
      />

      <DocsSection id="download" title="Download">
        <p>
          <C>evidence_pack_url</C> and <C>evidence_json_url</C> on the Verification point at these endpoints. Before a decision they answer <C>409</C> with{" "}
          <C>details.reason</C> = <C>evidence_not_ready</C>. Responses carry <C>X-Evidence-SHA256</C>, the hash of the file as stored.
        </p>
        <Sample sample={HTTP_SAMPLES.evidenceJson} />
        <Sample sample={HTTP_SAMPLES.evidencePdf} />
      </DocsSection>

      <DocsSection id="contents" title="What is in them">
        <RefTable
          caption="Evidence contents"
          head={["section", "contents"]}
          rows={[
            ["decision", "Status, method and its basis in the proposed rules, the decision in words, reasons, application date, income year, who decided (engine or a named reviewer with notes), and when the result expires."],
            ["household", "Household size; students by name and member id; every other member by initials, role and relationship only."],
            ["geography", "State, county, HUD income-limit area, 5-digit ZIP and how the county was determined."],
            ["threshold", "The limit used, its source (HUD-provisional or IRS-published), table version, effective date, formula, every reading with its figure, and which figure the income was compared with."],
            ["income / categorical", "Direct method: the counted income lines and totals. Categorical method: the program, letter date, approval status and agency — and no income detail."],
            ["documents / rails", "Identifiers, kinds and SHA-256 hashes of the files reviewed, and data-connection identifiers — never the raw files."],
            ["consent", "The family's consent record: copy version, timestamp, who consented."],
            ["review_trail / timeline", "Who or what reviewed exceptions, and the verification's history."],
          ]}
        />
        <Callout title="Data minimization">
          <p>
            Never included: dates of birth, Social Security numbers (not even masked), street addresses, email addresses, phone numbers, bank or card numbers, raw files. The
            record reports what was removed in <C>data_minimization</C>.
          </p>
        </Callout>
      </DocsSection>

      <DocsSection id="verify" title="Verify a signed record">
        <p>
          <C>signature.value</C> is an Ed25519 signature (<C>EdDSA</C>) over the canonical JSON bytes of <C>record</C> (RFC 8785 style: sorted keys, no floats). The public keys
          are published as a JWK Set at <C>/.well-known/jwks.json</C>; match <C>signature.kid</C> to a key there. Get the key set from our own site, not from whoever handed you
          the file.
        </p>
        <CodeBlock title="Shape of evidence.json" language="json" code={SIGNED_SHAPE} />
        <p>The repository ships a checker that prints PASS or FAIL (exit code 0 or 1):</p>
        <CodeBlock title="Online" language="bash" code={EVIDENCE_VERIFY_COMMAND.replace("{host}", SAMPLE_HOST)} />
        <CodeBlock title="Offline, with a saved key set" language="bash" code={EVIDENCE_VERIFY_OFFLINE_COMMAND.replaceAll("{host}", SAMPLE_HOST)} />
        <p>
          PASS means the record is byte-for-byte what was signed and the signature was made with a key in the key set you supplied. Both commands are run by our test suite on a
          record downloaded through the API.
        </p>
      </DocsSection>
    </>
  );
}
