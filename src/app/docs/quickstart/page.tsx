import type { Metadata } from "next";
import Link from "next/link";
import { Callout, CodeBlock } from "@/components/ui";
import { apiExamples, EVIDENCE_VERIFY_COMMAND, HTTP_SAMPLES, SAMPLE_HOST } from "@/server/api";
import { FAMILY_LINK_TTL_DAYS } from "@/server/verifications";
import { C, DocsHeader, Sample, Step } from "../_components";

export const metadata: Metadata = { title: "Quickstart" };

const json = (v: unknown) => JSON.stringify(v, null, 2);

export default function QuickstartPage() {
  return (
    <>
      <DocsHeader
        eyebrow="Quickstart"
        title="Your first verification in ten minutes"
        lead={<p>Everything below runs in test mode with curl. Each command on this page is executed by our test suite against the real API, so it works as printed.</p>}
      />

      <ol className="space-y-12">
        <Step n={1} title="Get a test key">
          <p>
            In the dashboard, open <strong>Developers → API keys</strong> and create a test key. It is shown once; keep it in your server&apos;s secret store. For this walkthrough,
            put it in your shell:
          </p>
          <CodeBlock language="bash" code={`export PASSPORT_API_KEY=ecca_test_…   # the key you just created`} />
          <Sample sample={HTTP_SAMPLES.me} />
        </Step>

        <Step n={2} title="Create a verification">
          <p>
            Send your own applicant id as <C>external_ref</C> so you can match results later. The <C>Idempotency-Key</C> makes the call safe to retry: a retry returns the same
            verification instead of creating a second one.
          </p>
          <Sample sample={HTTP_SAMPLES.createVerification} />
          <CodeBlock title="201 Created" language="json" code={json(apiExamples.EXAMPLE_VERIFICATION_CREATED)} />
          <Callout tone="warning" title="family_url and embed_url are shown only in this response">
            <p>They are the family&apos;s credential. Deliver one to the family and do not log it. Reads never return them again.</p>
          </Callout>
        </Step>

        <Step n={3} title="Send the family to the link">
          <p>
            Email or text <C>family_url</C> to the family, or frame <C>embed_url</C> on your own application page. Prefer that we email it? Create the verification with{" "}
            <C>{`"send_invite": true`}</C> and an <C>applicant_email</C>.
          </p>
          <p>
            The family signs in with a one-time email link or code, reads and accepts the sharing consent (who receives what, for what purpose, for how long), describes the
            household, then either uploads documents or connects a payroll or bank account. They never pay anything and never see a fee. The link works for {FAMILY_LINK_TTL_DAYS} days.
          </p>
        </Step>

        <Step n={4} title="Receive the webhook">
          <p>Register an endpoint for decisions and reviews. The response carries the signing secret, once.</p>
          <Sample sample={HTTP_SAMPLES.createWebhookEndpoint} />
          <p>
            When the decision is ready you receive <C>verification.decided</C> with the Verification as <C>data</C>. Check the signature before trusting it —{" "}
            <Link href="/docs/webhooks#verify">copy the verifier</Link>. You can also poll:
          </p>
          <Sample sample={HTTP_SAMPLES.getVerification} />
          <Sample sample={HTTP_SAMPLES.listVerifications} />
          <Sample sample={HTTP_SAMPLES.listEvents} />
        </Step>

        <Step n={5} title="Download the evidence">
          <p>
            Until a decision exists, evidence downloads answer <C>409</C> with <C>details.reason</C> <C>evidence_not_ready</C>:
          </p>
          <Sample sample={HTTP_SAMPLES.evidenceBeforeDecision} />
          <CodeBlock title="409 Conflict" language="json" code={json(apiExamples.EXAMPLE_EVIDENCE_NOT_READY)} />
          <p>Once decided, download the signed JSON record (or the PDF pack) and check its signature against our published keys:</p>
          <Sample sample={HTTP_SAMPLES.evidenceJson} />
          <CodeBlock language="bash" code={EVIDENCE_VERIFY_COMMAND.replace("{host}", SAMPLE_HOST)} />
        </Step>

        <Step n={6} title="Export into your other systems">
          <p>
            Pull a CSV in whatever column layout your applicant system imports — choose, order and rename columns. <Link href="/docs/csv-export">All columns</Link>.
          </p>
          <Sample sample={HTTP_SAMPLES.exportCsv} />
        </Step>
      </ol>
    </>
  );
}
