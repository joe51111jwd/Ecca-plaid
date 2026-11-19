import type { Metadata } from "next";
import { CodeBlock } from "@/components/ui";
import { API_RATE_LIMIT, apiExamples, ERROR_CODE_DOCS, ERROR_REASONS, IDEMPOTENCY_TTL_MS, MAX_JSON_BODY_BYTES, PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX } from "@/server/api";
import { C, DocsHeader, DocsSection, RefTable } from "../_components";

export const metadata: Metadata = { title: "Errors, limits & idempotency" };

export default function ErrorsPage() {
  const codes = Object.entries(ERROR_CODE_DOCS).sort((a, b) => a[1].status - b[1].status);
  return (
    <>
      <DocsHeader eyebrow="Reference" title="Errors, rate limits and idempotency" lead={<p>How the API says no, how fast you may call it, and how to retry safely.</p>} />

      <DocsSection id="errors" title="Errors">
        <p>
          Every error has the same shape. <C>code</C> is stable; <C>message</C> is for people; <C>details.fields</C> names invalid input fields (snake_case, dotted for nested
          fields); <C>details.reason</C> is a stable machine reason where one exists; <C>request_id</C> matches the <C>X-Request-Id</C> header. We never return stack traces or
          internal messages.
        </p>
        <CodeBlock title="422 Unprocessable Content" language="json" code={JSON.stringify(apiExamples.EXAMPLE_ERROR, null, 2)} />
        <RefTable caption="Error codes" head={["code", "HTTP", "meaning"]} rows={codes.map(([code, d]) => [code, String(d.status), d.meaning])} />
        <RefTable caption="Error reasons" head={["details.reason", "HTTP", "meaning"]} rows={ERROR_REASONS.map((r) => [r.reason, String(r.status), r.meaning])} />
        <p>
          Unknown fields in a body and unknown query parameters are refused (<C>422</C>), so a typo never silently does nothing. Bodies are JSON with{" "}
          <C>Content-Type: application/json</C>, at most {MAX_JSON_BODY_BYTES / 1024} KB.
        </p>
      </DocsSection>

      <DocsSection id="rate-limits" title="Rate limits">
        <p>
          {API_RATE_LIMIT.limit} requests per minute per key. Every authenticated response reports the window in <C>RateLimit-Limit</C>, <C>RateLimit-Remaining</C> and{" "}
          <C>RateLimit-Reset</C> (seconds). Over the limit you get <C>429</C> with <C>Retry-After</C>; wait that many seconds. Repeated requests with invalid keys from one
          address are slowed down as well.
        </p>
      </DocsSection>

      <DocsSection id="idempotency" title="Idempotency">
        <p>
          Send an <C>Idempotency-Key</C> header (any unique string up to 255 printable characters, such as a UUID or <C>booking-BK-2027-0042</C>) on POST requests to make them
          safe to retry after a timeout or a dropped connection:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Same key and same body: you get the first response back, with <C>Idempotent-Replayed: true</C>, and nothing happens twice.</li>
          <li>
            Same key, different body or endpoint: <C>409</C> <C>idempotency_key_reused</C>.
          </li>
          <li>
            Same key while the first request is still running: <C>409</C> <C>idempotency_request_in_progress</C> — retry shortly.
          </li>
          <li>Refusals (4xx) are remembered like successes. Server errors (5xx) and rate limits are not, so you can retry them with the same key.</li>
          <li>Keys are scoped to your organization and mode and are remembered for {IDEMPOTENCY_TTL_MS / 3_600_000} hours.</li>
        </ul>
      </DocsSection>

      <DocsSection id="pagination" title="Pagination">
        <p>
          List endpoints take <C>limit</C> (1–{PAGE_LIMIT_MAX}, default {PAGE_LIMIT_DEFAULT}) and <C>starting_after</C>, and return{" "}
          <C>{`{ "object": "list", "data": [...], "has_more": …, "next_cursor": … }`}</C>, newest first. Pass <C>next_cursor</C> as <C>starting_after</C> until{" "}
          <C>has_more</C> is false. Pages are keyset-based: records created while you page do not shift or repeat what you have already seen.
        </p>
      </DocsSection>
    </>
  );
}
