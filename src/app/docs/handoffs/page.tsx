import type { Metadata } from "next";
import { Callout, CodeBlock } from "@/components/ui";
import { HANDOFF_EMBED_CONTRACT, HANDOFF_EMBED_SNIPPET, HANDOFF_REDIRECT_SNIPPET, HTTP_SAMPLES } from "@/server/api";
import { FAMILY_AND_SCHOLARSHIP_PROTECTION, HOLD_WINDOW_HOURS } from "@/server/businesses";
import { BUSINESS_STATUS_DETAIL, HANDOFF_STATUSES, HOLD_EXTENSION_LIMITS } from "@/server/handoffs";
import { C, DocsHeader, DocsSection, RefTable, Sample } from "../_components";

export const metadata: Metadata = { title: "Point-of-booking handoff" };

export default function HandoffsPage() {
  return (
    <>
      <DocsHeader
        eyebrow="Camps & schools"
        title="Hold the booking while the family verifies"
        lead={
          <p>
            When a family wants to pay for a camp, school or tutoring booking with a scholarship, send them from your checkout to a partner SGO to verify household income. We
            hold the reservation for your stated window instead of dropping the sale, and tell you the outcome by webhook.
          </p>
        }
      />

      <Callout tone="warning" title="Eligible is not an award, and an award is not a payment">
        <p>
          A household verified as eligible means only that: the SGO still decides whether to award a scholarship, and pays under its own rules. Never tell a family that the
          booking is paid because they verified. Complete the booking only after the handoff is <C>awarded</C>. {FAMILY_AND_SCHOLARSHIP_PROTECTION} Your success fee is billed
          to your business account.
        </p>
      </Callout>

      <DocsSection id="flow" title="How it works">
        <ol className="list-decimal space-y-2 pl-6">
          <li>Your server creates a handoff with your secret business key and gets a one-time URL.</li>
          <li>You redirect the family to it (or frame it with the embed). The hold starts now and lasts your hold window ({HOLD_WINDOW_HOURS.min}–{HOLD_WINDOW_HOURS.max} hours, set in your business settings).</li>
          <li>The family verifies with your partner SGO; if you have several partners and named none, the family chooses.</li>
          <li>You receive <C>handoff.*</C> webhooks as the status moves, and the family comes back to your <C>return_url</C>.</li>
          <li>If the SGO awards a scholarship, you complete the booking with scholarship funds and call <C>complete</C>.</li>
        </ol>
        <RefTable caption="Handoff statuses" head={["status", "what it means for you"]} rows={HANDOFF_STATUSES.map((s) => [s, BUSINESS_STATUS_DETAIL[s]])} />
      </DocsSection>

      <DocsSection id="redirect" title="Server-side create and redirect">
        <p>
          Recommended. Use an <C>Idempotency-Key</C> derived from your booking id so a retry never creates a second handoff. Store the handoff id with the booking; never store or
          log the URL — it is the family&apos;s credential.
        </p>
        <CodeBlock title="checkout.js" language="js" code={HANDOFF_REDIRECT_SNIPPET} />
        <Sample sample={HTTP_SAMPLES.createHandoff} />
        <Sample sample={HTTP_SAMPLES.getHandoff} />
        <Sample sample={HTTP_SAMPLES.extendHold} />
        <p>
          Extend a hold by whole hours while it is held (at most {HOLD_EXTENSION_LIMITS.maxTotalHours} extra hours over a handoff&apos;s life). Completing before an award
          answers <C>409</C>:
        </p>
        <Sample sample={HTTP_SAMPLES.completeBeforeAward} />
        <Sample sample={HTTP_SAMPLES.cancelHandoff} />
      </DocsSection>

      <DocsSection id="embed" title="The embed script">
        <p>
          For booking pages that cannot redirect. The script adds one iframe served from our host to your page. It uses your <strong>publishable</strong> key (
          <C>pk_test_…</C> / <C>pk_live_…</C>) — public by design, and accepted only from the origins listed in your business settings. A booking amount sent from the browser is
          recorded as unconfirmed; confirm it server-side when you complete the handoff.
        </p>
        <CodeBlock title="booking.html" language="html" code={HANDOFF_EMBED_SNIPPET} />
        <RefTable
          caption="Script attributes"
          head={["attribute", "required", "meaning"]}
          rows={HANDOFF_EMBED_CONTRACT.attributes.map((a) => [a.name, a.required ? "yes" : "no", a.description])}
        />
        <p>
          The frame posts messages with <C>source: &quot;{HANDOFF_EMBED_CONTRACT.messageSource}&quot;</C>; the script checks their origin and frame and re-dispatches them on the
          script element as a bubbling <C>{HANDOFF_EMBED_CONTRACT.domEvent}</C> DOM event whose <C>detail</C> is the message:
        </p>
        <RefTable caption="Embed events" head={["detail.type", "detail"]} rows={HANDOFF_EMBED_CONTRACT.events.map((e) => [e.type, e.detail])} />
        <p>
          When the family is sent back, your <C>return_url</C> receives <C>{HANDOFF_EMBED_CONTRACT.returnQuery.map((q) => `${q}=…`).join("&")}</C>. Treat it, and the page
          events, as hints for your interface only: confirm with the webhook or <C>{`GET /api/v1/handoffs/{id}`}</C> before you change the booking.
        </p>
      </DocsSection>

      <DocsSection id="family" title="What the family sees">
        <ul className="list-disc space-y-2 pl-6">
          <li>Your booking (reference, description, amount) and how long the spot is held, in English or Spanish.</li>
          <li>The partner SGO they are verifying with — or a choice between your partners.</li>
          <li>A one-time sign-in by email, a consent screen that says who receives what and for how long, then documents or a payroll/bank connection.</li>
          <li>Plain statements that verifying is not an award and that they will never be charged a fee.</li>
          <li>They can leave at any time; that cancels the handoff and ends the hold.</li>
        </ul>
        <p>
          You never receive the family&apos;s income, documents, contact details or the student&apos;s name through the API — only the status, the hold, whether they were
          eligible, and any award amount and payment method.
        </p>
      </DocsSection>
    </>
  );
}
