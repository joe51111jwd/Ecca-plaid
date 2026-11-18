# Emmy (DSACMS/iv-cbv-payroll) reference design: consent flow states and audit-ready evidence package

Drives: Piece 2 (family intake flow states) and Piece 3 (evidence pack, retention jobs, webhooks).

## How to read this file

- **What was studied.** A shallow clone of `https://github.com/DSACMS/iv-cbv-payroll` at
  `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/emmy`
  (HEAD `be62e541e08ab81b111219801c8afa5733d570e4`, commit date 2026-11-10, app version `0.16.0`).
  Provenance note: `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/extra/emmy-clone-provenance.txt`.
- **Paths.** Every `emmy/...` path below is relative to that clone. Line numbers are from that commit.
- **Confidence tags.** Everything here describes what the Emmy code and docs do. It is a design reference,
  not law. All Emmy facts carry `[secondary/web]` (Emmy repo, CC0). Nothing in this file is a statement
  about IRC section 25F, the proposed regulations, or the temporary regulations. Where our own spec is
  cited it is written as `spec frame_1.txt:NNN`.
- **Emmy has two flows.** `CbvFlow` ("Emmy Income": payroll-connected income report) and `ActivityFlow`
  ("Emmy CE": community-engagement hours with self-attestation and document upload). The income flow is
  the model for our auto-submit path; the activity flow is the model for our upload path.
- **"NOT IN SOURCES"** means the Emmy repo does not say. It is never a guess.
- **Fact-check status.** This file was adversarially re-verified against the clone on 2026-11-18. Items
  changed by that pass are marked **(CORRECTED)**, new items **(ADDED)**, and anything that could not be
  confirmed from the clone **UNVERIFIED**. See the VERIFICATION LOG at the end. Facts 110 to 116 were
  added by the fact-check.

---

## FACTS

### A. License and provenance

1. **Emmy is CC0 1.0 Universal; code and copy can be reused, including commercially.**
   - Quote: "CC0 1.0 Universal" / "You can copy, modify, distribute, and perform the work, even for commercial purposes, all without asking permission."
   - Source: `emmy/LICENSE:3`; `emmy/LICENSE.md:15`. Also `emmy/code.json:10` (`"name": "CC0-1.0"`).
   - [secondary/web]

2. **It is also a US government work in the US public domain; contributions are CC0 too.**
   - Quote: "As a work of the [United States government](https://www.usa.gov/), this project is in the public domain within the United States of America." / "Additionally, we waive copyright and related rights in the work worldwide through the CC0 1.0 Universal public domain dedication."
   - Source: `emmy/LICENSE.md:3`, `emmy/LICENSE.md:5`; restated `emmy/README.md:84`, `emmy/README.md:86`.
   - [secondary/web]

3. **CC0 does not license trademarks or patents and we must not imply CMS endorsement.**
   - Quote: "In no way are the patent or trademark rights of any person affected by CC0" / "When using or citing the work, you should not imply endorsement by the author or the affirmer."
   - Source: `emmy/LICENSE.md:19`, `emmy/LICENSE.md:21`; legal code `emmy/LICENSE:104`.
   - [secondary/web]

4. **Emmy describes itself as an applicant-first tool that produces an "audit-ready evidence package", and it is Medicaid-specific.**
   - Quote: "Designed with an applicant-first approach, the Emmy App guides users through reporting and verifying information — the tool connects to trusted data sources to reduce redundant questions, and generates a standardized, audit-ready evidence package for the state."
   - Source: `emmy/README.md:9`.
   - [secondary/web]

### B. Data model

5. **There is no status enum on a flow. Flow state is derived from nullable timestamps and one code column.** `cbv_flows` columns include `consented_to_authorized_use_at`, `confirmation_code`, `transmitted_at`, `json_transmitted_at`, `redacted_at`, `has_other_jobs`, `device_id`, `end_user_id` (uuid, default random), `argyle_user_id`, `pinwheel_token_id`, `payroll_data_available_from`, `additional_information` (jsonb).
   - Quote: `t.datetime "consented_to_authorized_use_at"` / `t.string "confirmation_code"` / `t.datetime "transmitted_at"`
   - Source: `emmy/app/db/schema.rb:172-191`.
   - [secondary/web]

6. **"Complete" means a confirmation code exists.**
   - Quote: `scope :incomplete, -> { where(confirmation_code: nil) }` / `def complete?` `confirmation_code.present?`
   - Source: `emmy/app/app/models/cbv_flow.rb:5-6`, `:13-15`.
   - [secondary/web]

7. **Invitation table.** `cbv_flow_invitations`: `auth_token` (unique while unredacted), `client_agency_id`, `cbv_applicant_id`, `email_address`, `expires_at`, `language`, `manually_expired` (boolean, default false), `redacted_at`, `user_id`, `verification_range`. One invitation has many flows.
   - Quote: `t.index ["auth_token"], name: "index_cbv_flow_invitations_on_auth_token", unique: true, where: "(redacted_at IS NULL)"`
   - Source: `emmy/app/db/schema.rb:154-170`; `emmy/app/app/models/cbv_flow_invitation.rb:17`.
   - [secondary/web]

8. **Payroll account table (one per connected employer/provider login).** `payroll_accounts`: polymorphic `flow_type`/`flow_id`, `aggregator_account_id`, `type` (STI: `pinwheel` or `argyle`), `synchronization_status` (default `unknown`), `supported_jobs` (string array), `income_synced_at`, `data_source` (default `validated`), `draft`, `additional_information` (the applicant's free-text comment), `redacted_at`.
   - Quote: `enum :synchronization_status, {` `unknown: "unknown", # defines the method: sync_unknown?` `in_progress: "in_progress", # defines the method: sync_in_progress?` `succeeded: "succeeded", # defines the method: sync_succeeded?` `failed: "failed" # defines the method: sync_failed?` `}, prefix: "sync"` (quote completed by fact-check; the original omitted two of the four lines)
   - Source: `emmy/app/db/schema.rb:339-355`; `emmy/app/app/models/payroll_account.rb:18-25`.
   - [secondary/web]

9. **Webhook events are persisted as rows and are the source of truth for per-job sync status.** `webhook_events`: `payroll_account_id`, `event_name`, `event_outcome`, timestamps.
   - Quote: `class WebhookEvent < ApplicationRecord` `belongs_to :payroll_account`
   - Source: `emmy/app/db/schema.rb:529-536`; `emmy/app/app/models/webhook_event.rb:1-3`.
   - [secondary/web]

10. **The applicant record holds agency case identifiers and is per-agency configurable.** `cbv_applicants` has `case_number`, `client_id_number`, `agency_id_number`, `beacon_id`, `doc_id`, `individual_id`, `snap_application_date`, names, `date_of_birth`, `income_changes`. Which attributes are accepted, required, and redacted is declared per agency in YAML.
    - Quote: `date_of_birth:` `required: true` `redaction_type: date`
    - Source: `emmy/app/db/schema.rb:135-152`; `emmy/app/config/client-agency-config.yml:55-73`.
    - [secondary/web]

11. **The income flow does not persist payroll data.** Every page that shows income (payment details, summary, submit, PDF) and the transmit job re-fetch the report live from the aggregator API through `AggregatorReportFetcher`. The PDF is generated on demand and is not stored.
    - Quote: `fetcher = AggregatorReportFetcher.new(@cbv_flow)` `@aggregator_report = fetcher.report`
    - Source: `emmy/app/app/helpers/cbv/aggregator_data_helper.rb:4-7`; `emmy/app/app/jobs/case_worker_transmitter_job.rb:38`; `emmy/app/app/services/pdf_service.rb:22-41`.
    - [secondary/web]

12. **Household launcher (activity flow only).** A `households` row has its own `auth_token` and many `household_members`, each bound to exactly one invitation. The page asks "Who are you reporting for?" and each member card shows "Get started" or a disabled "Complete".
    - Quote: `title: Who are you reporting for?` / `validates :activity_flow_invitation_id, uniqueness: true`
    - Source: `emmy/app/db/schema.rb:254-278`; `emmy/app/app/models/household_member.rb:14-16`; `emmy/app/app/views/households/show.html.erb` (member cards); `emmy/app/config/locales/en.yml:1436-1440`.
    - [secondary/web]

### C. Invitations, tokens, entry

13. **An agency system creates an invitation by API; Emmy does not send it.** `POST /api/v1/invitations` with `Authorization: Bearer API_KEY`. The response carries `tokenized_url`, `expiration_date`, `language`, and the echoed `agency_partner_metadata`.
    - Quote: "The endpoint does not send email or SMS. Deliver the returned link or redirect the applicant to it. Each request creates a new invitation; there is no idempotency key or deduplication. Treat tokens as opaque."
    - Source: `emmy/docs/api/invitations.md:7-9`; `emmy/app/app/controllers/api/invitations_controller.rb:17-24`; route `emmy/app/config/routes.rb:146`.
    - (ADDED nuance) "Does not send" is true of the API path only: both API controllers call the invitation service with `delivery_method: nil` (`emmy/app/app/controllers/api/invitations_controller.rb:10`; `emmy/app/app/controllers/api/v2/invitations_controller.rb:21`). The service's default is still `delivery_method: :email`, which sends `ApplicantMailer#invitation_email` (`emmy/app/app/services/cbv_invitation_service.rb:6`, `:17-19`, `:56-60`), but no caller in this commit uses that default. The invitation-email copy quoted in Deliverable 5 (patterns 4 and 10) belongs to that dormant mailer path and is SNAP-pilot wording (`emmy/app/config/locales/en.yml:887`).
    - [secondary/web]

14. **The API key decides the tenant, never the payload.**
    - Quote: "For invitation requests, each key identifies an agency and its configured metadata and invitation settings. Sending a `client_agency_id` cannot select another agency."
    - Source: `emmy/docs/api/introduction.md:68-69`; enforcement in `emmy/app/app/controllers/api/invitations_controller.rb:50-63`.
    - [secondary/web]

15. **API keys are 32 random alphanumerics, stored encrypted, soft-deletable, and only work for service accounts.**
    - Quote: `encrypts :access_token, deterministic: true` / `self.access_token = SecureRandom.alphanumeric(32)`
    - Source: `emmy/app/app/models/api_access_token.rb:4-8`; `emmy/app/app/models/user.rb:8-12`.
    - [secondary/web]

16. **The invitation token is a 10-character secure token, and Emmy lowered the Rails minimum to allow it.** It is a reusable bearer link, not a single-use login link.
    - Quote: `has_secure_token :auth_token, length: 10` / "Lowering this minimum to support our 10 character tokenized links" `MINIMUM_TOKEN_LENGTH = 10`
    - Source: `emmy/app/app/models/cbv_flow_invitation.rb:19`; `emmy/app/config/initializers/active_record/secure_token.rb:6-7`.
    - [secondary/web]

17. **Invitation expiry is end-of-day in America/New_York plus a per-agency number of days** (14 sandbox, 30 NH, 75 LA in this config).
    - Quote: "Invitations are valid until 11:59pm Eastern Time on the (e.g.) 14th day after sending the invitation."
    - Source: `emmy/app/app/models/concerns/invitation_expiration.rb:4`, `:16-23`; `emmy/app/config/client-agency-config.yml:44`, `:141`, `:227`.
    - [secondary/web]

18. **An invitation is "expired" if the clock passed `expires_at` or it was redacted.** An agency can expire a link early with an idempotent `DELETE`; unknown or other-tenant tokens return 404.
    - Quote: `Time.current.after?(expires_at) || redacted_at?` / `invitation.update!(expires_at: [ invitation.expires_at, Time.current ].compact.min, manually_expired: true)`
    - Source: `emmy/app/app/models/cbv_flow_invitation.rb:51-53`; `emmy/app/app/controllers/api/invitations_controller.rb:27-46`; `emmy/docs/api/invitations.md:37-43`.
    - [secondary/web]

19. **Every click on a valid tokenized link creates a brand new flow row and binds it to the browser session.** Three failure branches: unknown token (redirect home with an error), expired (dedicated expired page plus event), and arriving on a deep page with no session cookie (redirect home with a "session timed out" notice plus event).
    - Quote: `@flow = flow_class.create_from_invitation(` / `set_flow_session(@flow.id, flow_param)` / `track_deeplink_without_cookie_event`
    - Source: `emmy/app/app/controllers/flow_controller.rb:56-106`.
    - [secondary/web]

20. **Tokens are normalized before lookup so trailing punctuation from SMS or email does not break the link.**
    - Quote: `ALPHANUMERIC_PREFIX_REGEXP = /^([a-zA-Z0-9]+)[^a-zA-Z0-9]*$/`
    - Source: `emmy/app/app/controllers/application_controller.rb:4`, `:144-146`.
    - [secondary/web]

21. **There is a second entry mode with no invitation: a "generic link" per agency.** It creates an empty applicant plus a flow, and later asks the person to type their own identifying details (the "applicant information" step, skipped for invitation flows). Agencies can disable it.
    - Quote: `scope "links/:client_agency_id"` / `redirect_to next_path if @cbv_flow.cbv_flow_invitation.present?`
    - Source: `emmy/app/config/routes.rb:41-44`; `emmy/app/app/controllers/flow_controller.rb:4-17`, `:47-54`; `emmy/app/app/controllers/cbv/applicant_informations_controller.rb:55-57`; `emmy/app/app/controllers/cbv/generic_links_controller.rb:28-33`.
    - [secondary/web]

22. **Link origin is tracked with an `origin` query parameter** (for example `sms`, `email`, `mail`, `shared`), stored in the session, normalized and capped at 64 characters.
    - Quote: `session[:cbv_origin] = origin.strip.downcase.gsub(/\s+/, "_").first(64)`
    - Source: `emmy/app/app/controllers/cbv/base_controller.rb:9-29`; `emmy/docs/api/invitations.md:19-21`.
    - [secondary/web]

23. **Activity invitations can be made single-completion.** With `allow_activity_invitation_reuse: false`, a link whose flow was already completed is treated like an expired link. The household launcher resumes the newest incomplete flow instead of creating a new one.
    - Quote: `super || (!agency.allow_activity_invitation_reuse && invitation.used?)` / `invitation.activity_flows.incomplete.order(created_at: :desc).first ||`
    - Source: `emmy/app/app/controllers/activities/base_controller.rb:84-87`; `emmy/app/app/models/activity_flow.rb:51-54`; `emmy/app/config/client-agency-config.yml:45-46`.
    - [secondary/web]

### D. Session and timeouts

24. **Sessions are cookie-store sessions that expire after 30 minutes.**
    - Quote: `config.cbv_session_expires_after = 30.minutes` / `expire_after: Rails.application.config.cbv_session_expires_after`
    - Source: `emmy/app/config/application.rb:52`; `emmy/app/config/initializers/session_store.rb:3-5`.
    - [secondary/web]

25. **The browser shows a warning modal 5 minutes before expiry with "extend" and "end" choices, then hard-redirects at expiry.** Extend is a `POST /cbv/session/refresh`; end is `GET /cbv/session/end`, which clears the flow from the session and lands on a timeout page.
    - Quote: "Calculate when to show the warning (5 minutes before expiration)" / `` window.location = `/cbv/session/end?timeout=true` ``
    - Source: `emmy/app/app/javascript/controllers/cbv/sessions_controller.js:29-53`; `emmy/app/app/controllers/cbv/sessions_controller.rb:4-18`; `emmy/app/config/routes.rb:47-49`.
    - [secondary/web]

26. **The session timeout is disabled on the "we're gathering your data" sync page**, so a slow provider does not log the person out.
    - Quote: `def session_timeout_enabled?` `false`
    - Source: `emmy/app/app/controllers/cbv/synchronizations_controller.rb:31-33`.
    - [secondary/web]

27. **After a timeout the person restarts with the same link (which creates a new flow); nothing unsent is kept.** (CORRECTED: the original quoted the activity-flow timeout page as if it were the income-flow page.)
    - Quote, income-flow timeout page: "Sessions end after 30 minutes of being away from the page. This helps keep your information safe." / "To report your income, start again. Use the link %{agency_full_name} sent you in a text message."
    - Source: `emmy/app/config/locales/en.yml:1524`, `:1526`; restart notice "Please reuse the same link you used to begin your session." at `:1097`.
    - Quote, activity-flow (CE) timeout page only: "Sessions end after 30 minutes of inactivity. This helps keep your information safe. Any information not submitted was not saved."
    - Source: `emmy/app/config/locales/en.yml:1488` (key `pages.activity_flow_timeout.description`).
    - The "nothing unsent is kept" sentence is therefore stated in copy only for the activity flow. For the income flow it follows from the code (a new flow row on every link click, fact 19), not from a quoted sentence.
    - [secondary/web]

28. **Flow pages are sent with no-store cache headers, and a completed flow redirects every page to the success page.**
    - Quote: `response.headers["Cache-Control"] = "no-cache, no-store, max-age=0, must-revalidate"` / `redirect_to(cbv_flow_success_path)`
    - Source: `emmy/app/app/controllers/cbv/base_controller.rb:31-35`, `:49-53`.
    - [secondary/web]

29. **A signed, httponly, permanent `device_id` cookie (random UUID) correlates events and logs without PII.**
    - Quote: `cookies.permanent.signed[:device_id] ||= {` `value: SecureRandom.uuid,` `httponly: true,`
    - Source: `emmy/app/app/controllers/application_controller.rb:32-38`.
    - [secondary/web]

### E. Applicant flow steps and the two consent moments

30. **The step order is a single lookup table keyed by the current controller.**
    - Quote: `when "cbv/entries"` `cbv_flow_employer_search_path` ... `when "cbv/summaries"` `cbv_flow_submits_path` `when "cbv/submits"` `cbv_flow_success_path`
    - Source: `emmy/app/app/services/cbv_flow_navigator.rb:8-31`.
    - [secondary/web]

31. **Consent moment 1 (entry): an "agreement" checkbox to access and share data. It is enforced on submit of that page but is not persisted on the flow.** It only produces analytics events (`ApplicantViewedAgreement`, `ApplicantConsentedToTerms` on tick, `ApplicantAgreed` on continue). There is no server-side gate on later pages that checks the agreement was given.
    - Quote: `if params["agreement"] == "1"` ... `redirect_to next_path` `else` `redirect_to(cbv_flow_entry_path, flash: { alert: t(".error") })`
    - Source: `emmy/app/app/controllers/cbv/entries_controller.rb:13-27`; `emmy/app/app/javascript/controllers/cbv/entry_page_controller.js:7-11`; no agreement column in `emmy/app/db/schema.rb:172-191`.
    - [secondary/web]

32. **Consent moment 2 (submit): a "Legal agreement" attestation checkbox. This one is persisted as a timestamp, then the confirmation code is generated and transmission is queued.**
    - Quote: `@cbv_flow.update(consented_to_authorized_use_at: timestamp)` / `@cbv_flow.update!(confirmation_code: confirmation_code)` / `CaseWorkerTransmitterJob.perform_later(@cbv_flow.id)`
    - Source: `emmy/app/app/controllers/cbv/submits_controller.rb:54-69`.
    - (ADDED nuance) The three writes are separate statements, not one transaction, and the enqueue line itself has no guard. Repeat submits are stopped earlier: the inherited `ensure_cbv_flow_not_yet_complete` before-action redirects any flow that already has a confirmation code to the success page (`emmy/app/app/controllers/cbv/base_controller.rb:31-35`; it is skipped only for the PDF format, `submits_controller.rb:18`), and the job allows one execution per flow at a time (`emmy/app/app/jobs/case_worker_transmitter_job.rb:16-25`). Two near-simultaneous submits could still both enqueue.
    - [secondary/web]

33. **Emmy stores no consent copy version, no hash of the consent text, and no locale-of-consent on the flow.** Only the timestamp in fact 32. (Our spec requires "a stored timestamp and copy version", spec frame_1.txt:179.)
    - Quote: `t.datetime "consented_to_authorized_use_at"` (the only consent column)
    - Source: `emmy/app/db/schema.rb:178`.
    - [secondary/web]

34. **The applicant cannot download the PDF until the attestation is given.**
    - Quote: `next if redirect_unless_consent!(t("cbv.submits.update.consent_to_authorize_warning"))`
    - Source: `emmy/app/app/controllers/cbv/submits_controller.rb:23-24`, `:80-90`.
    - [secondary/web]

35. **Confirmation code format: agency id without underscores, 3 base-36 characters derived from the clock, then the flow id left-padded to 4, all upper-cased.** It is shown to the applicant and is the join key across the PDF, JSON, CSV, filenames, and HTTP headers. (CORRECTED: the look-alike swap the code appears to intend does not actually happen.)
    - Quote: `(Time.now.to_i % 36 ** 3).to_s(36).tr("OISB", "0158").rjust(3, "0")` ... `].compact.join.upcase`
    - Source: `emmy/app/app/controllers/concerns/confirmation_code_generatable.rb:6-13`.
    - **The O/I/S/B to 0/1/5/8 swap is a no-op as written.** Ruby's `Integer#to_s(36)` returns lower-case letters, `tr("OISB", "0158")` only matches upper-case letters, and the upper-casing happens afterwards on the joined string. Verified by running the expression in Ruby during the fact-check: a clock value whose base-36 digits are `o`, `i`, `s` produced `SANDBOXOIS0042`, with O, I and S intact. The agency prefix also contributes such letters (`SANDBOX`). So Emmy's codes do contain look-alike characters. Do not cite Emmy as a working example of look-alike removal; if we want that property we must implement and test it ourselves.
    - Other properties visible in the code: the 3 clock characters repeat every 46,656 seconds (36^3), so uniqueness comes from the flow id, not the clock part; the flow id is padded to 4 digits but is not capped at 4.
    - [secondary/web]

36. **Before submit, the person reviews each employer's data and can attach a free-text comment that travels with the report.** The comment is sanitized on write.
    - Quote: "Please review your information. If something is missing or inaccurate, add a comment for %{agency_acronym}. This will be included in your income report." / `super(ActionController::Base.helpers.sanitize(value))`
    - Source: `emmy/app/config/locales/en.yml:1160`; `emmy/app/app/models/payroll_account.rb:70-72`; `emmy/app/app/views/cbv/payment_details/show.html.erb:31-37`.
    - [secondary/web]

37. **Two explicit yes/no questions cover completeness: "another job to add with this tool?" and "other income you need to report separately?"** A missing answer is an error. The second answer (`has_other_jobs`) is printed in the report.
    - Quote: "Do you have another job to add?" / "Do you need to report other income from your work?" / "You must select an answer to continue."
    - Source: `emmy/app/config/locales/en.yml:927`, `:1120`, `:1590`; `emmy/app/app/controllers/cbv/add_jobs_controller.rb:7-30`; `emmy/app/app/controllers/cbv/other_jobs_controller.rb:7-23`.
    - [secondary/web]

38. **Every dead end offers a fallback path instead of a stop.** "Can't find employer" page, sync-failure page with three options, expired-link page with a button to the agency site, maintenance and technical-difficulty pages.
    - Quote: "We were unable to connect to your employer's system due to an error. To continue, you can:" / "Go back to employer search to retry adding this employer."
    - Source: `emmy/app/config/locales/en.yml:1262-1266`, `:1105-1117`, `:1099-1104`, `:1477-1485`.
    - [secondary/web]

39. **After success: confirmation code, "Download my report", next steps, and a link to share.**
    - Quote: "Your income report was successfully sent to %{agency_acronym}." / "<strong>Your confirmation code</strong>: %{confirmation_code}"
    - Source: `emmy/app/config/locales/en.yml:1223-1227`; `emmy/app/app/views/cbv/successes/show.html.erb:1-18`.
    - [secondary/web]

### F. Payroll connect, webhooks, sync states

40. **The rail-side user identifier is a random UUID generated per flow, not PII.** The browser asks Emmy's server for a link/user token, opens the aggregator modal, and Emmy stores the aggregator's user id on the flow so webhooks can be matched. (CORRECTED: the original called the token "short-lived". The Emmy code does not state a lifetime; it only handles a token-expired callback, fact 109. Token lifetime is the rail vendor's property: NOT IN SOURCES.)
    - Quote: `t.uuid "end_user_id", default: -> { "gen_random_uuid()" }, null: false` / `response = argyle.create_user(@flow.end_user_id)` / "Store the argyle_user_id to allow us to associate incoming webhooks with this CbvFlow."
    - Source: `emmy/app/db/schema.rb:181`; `emmy/app/app/controllers/api/argyle_controller.rb:9-33`; `emmy/app/app/controllers/api/pinwheel_controller.rb:5-19`.
    - [secondary/web]

41. **Argyle webhooks are authenticated with HMAC-SHA512 over the raw body; Pinwheel with a signature over timestamp plus raw body. Invalid signature returns 401; unknown flow or unhandled event returns 200 and is ignored.**
    - Quote: `OpenSSL::HMAC.hexdigest(OpenSSL::Digest.new("sha512"), webhook_secret, payload)` / `render json: { error: "Invalid signature" }, status: :unauthorized`
    - Source: `emmy/app/app/services/aggregators/webhooks/argyle.rb:79-88`; `emmy/app/app/controllers/webhooks/argyle/events_controller.rb:69-97`; `emmy/app/app/controllers/webhooks/pinwheel/events_controller.rb:23-40`.
    - (ADDED detail) Pinwheel's scheme in Emmy's code is HMAC-SHA256 over `"v2:#{timestamp}:#{raw_body}"`, keyed with the Pinwheel API key, sent as `v2=<hex>` in `X-Pinwheel-Signature` with the timestamp in `X-Timestamp` (`emmy/app/app/services/aggregators/sdk/pinwheel_service.rb:138-150`). Both rails are compared with `ActiveSupport::SecurityUtils.secure_compare` (constant time).
    - (ADDED caution) **Order of checks.** In both controllers the flow lookup runs before the signature check (`before_action :set_cbv_flow, :authorize_webhook` at `argyle/events_controller.rb:4`; `:set_cbv_flow, :set_pinwheel, :authorize_webhook` at `pinwheel/events_controller.rb:4`). A request naming an unknown user therefore gets `200 {"status":"ok"}` without its signature ever being verified. That is harmless in Emmy because nothing is written, but it is not a pattern to copy: verify the signature first.
    - [secondary/web]

42. **Argyle event map (event to outcome to jobs).** `identities.added` success (identity, income); `paystubs.partially_synced` unknown-until-enough-days (paystubs, employment); `gigs.partially_synced` unknown-until-enough-days (gigs); `accounts.connected` success (accounts); `users.fully_synced` success (no jobs); `paystubs.fully_synced` success; `gigs.fully_synced` success; `accounts.updated` unknown, flipped to error when the payload shows a system error.
    - Quote: `"paystubs.partially_synced" => {` `status: :unknown,` `type: :partial,` `job: %w[paystubs employment]`
    - Source: `emmy/app/app/services/aggregators/webhooks/argyle.rb:16-66`.
    - [secondary/web]

43. **Pinwheel subscribed events and job mapping.** Events: `account.added`, `paystubs.added`, `paystubs.fully_synced`, `employment.added`, `income.added`, `identity.added`, `shifts.added`. The outcome comes from the webhook payload.
    - Quote: `"paystubs" => "paystubs.fully_synced",` `"employment" => "employment.added",` `"income" => "income.added",` `"identity" => "identity.added",` `"shifts" => "shifts.added"`
    - Source: `emmy/app/app/services/pinwheel_webhook_manager.rb:10-18`; `emmy/app/app/models/payroll_account/pinwheel.rb:2-10`; `emmy/app/app/controllers/webhooks/pinwheel/events_controller.rb:14-18`.
    - [secondary/web]

44. **Per-job status is one of four values, computed from webhook rows.**
    - Quote: ":unsupported - The job is not supported for this account. :succeeded - The job completed successfully. :failed - The job completed with an error. :in_progress - The job has not yet completed."
    - Source: `emmy/app/app/models/payroll_account.rb:47-54`; `emmy/app/app/models/payroll_account/argyle.rb:33-43`.
    - [secondary/web]

45. **"Fully synced" means every supported job has reported success or error. Only then is the account marked `succeeded` or `failed`, and success needs two things: the minimum jobs succeeded and the fetched report passes a "useful report" validation.**
    - Quote: `if payroll_account.necessary_jobs_succeeded? && validate_useful_report_requirements(report)` `payroll_account.update(synchronization_status: :succeeded)` ... `else` `payroll_account.update(synchronization_status: :failed)`
    - Source: `emmy/app/app/controllers/webhooks/argyle/events_controller.rb:135-164`; `emmy/app/app/models/payroll_account/argyle.rb:18-27`, `:45-47`; `emmy/app/app/models/payroll_account/pinwheel.rb:41-43`.
    - (ADDED detail) "Minimum jobs" differs per rail. Argyle: `job_succeeded?("accounts") && (job_succeeded?("paystubs") || job_succeeded?("gigs"))` (`payroll_account/argyle.rb:45-47`). Pinwheel: `job_succeeded?("paystubs") || (job_succeeded?("employment") && job_succeeded?("identity"))` (`payroll_account/pinwheel.rb:41-43`). For Pinwheel, "fully synced" means the completion webhook for each supported job has arrived, whatever its outcome (`payroll_account/pinwheel.rb:17-23`).
    - [secondary/web]

46. **The "useful report" validator is a small, explicit data-quality gate.** (CORRECTED wording: the original said "at least one identity with a full name"; the code is stricter.) It requires: at least one identity, and every identity has a full name; at least one employment, and every employment has an employer name; and, only when paystubs exist and the person is not judged "unemployed", at least one paystub with a pay date, at least one with a gross amount present, and at least one with a gross amount above zero (these need not be the same paystub). "Unemployed" means any employment has a status other than `employed`, or a termination date, or zero total hours and zero total gross pay; in that case the paystub checks are skipped so that a confirmed job loss can still be reported.
    - Quote: `report.errors.add(:paystubs, "No paystub has valid gross_pay_amount") unless report.paystubs.any? { |paystub| paystub.gross_pay_amount.to_f > 0 }`
    - Source: `emmy/app/app/services/aggregators/validators/useful_report_validator.rb:5-19`, `:27-39`, `:45-57`. An hours check for W-2 workers is commented out (`:58-63`).
    - [secondary/web]

47. **Partial-sync shortcut:** a `*.partially_synced` webhook counts as success once `days_synced` reaches the configured lookback, so the person does not wait for the provider's full history.
    - Quote: `if days_synced.to_i >= aggregator_lookback_days.values.max` `webhook_event.update(event_outcome: "success")`
    - Source: `emmy/app/app/controllers/webhooks/argyle/events_controller.rb:124-133`.
    - [secondary/web]

48. **The waiting page polls every 2 seconds and the server answers with one of three actions: redirect to failure, redirect to review, or re-render progress.** Four progress indicators are shown: Income, Employment, Paystubs, Personal details. A delay banner appears after 5 minutes.
    - Quote: `}, 2000)` / `@payroll_account.created_at < 5.minutes.ago`
    - Source: `emmy/app/app/javascript/controllers/polling_controller.js:9-23`; `emmy/app/app/controllers/cbv/synchronizations_controller.rb:13-27`; `emmy/app/app/controllers/concerns/sync_delay_alert.rb:10-12`; `emmy/app/config/locales/en.yml:1267-1276`.
    - [secondary/web]

49. **Tenant and session isolation checks on connected accounts.** An account id that belongs to another flow sends the person to the failure page; a payment-details request for an account not on the current flow is refused.
    - Quote: "security check - make sure the account_id is associated with the current cbv_flow_id"
    - Source: `emmy/app/app/controllers/cbv/payment_details_controller.rb:22-25`; `emmy/app/app/controllers/cbv/synchronizations_controller.rb:47-59`.
    - [secondary/web]

50. **Returning to an employer that is already connected resumes that connection instead of creating a duplicate.**
    - Quote: "Redirect if the user is attempting to connect a previously connected account"
    - Source: `emmy/app/app/controllers/api/argyle_controller.rb:49-77`.
    - [secondary/web]

51. **Lookback is per-agency config with only two allowed values (90 or 182 days).**
    - Quote: `VALID_PAY_INCOME_DAYS = [ 90, 182 ]`
    - Source: `emmy/app/lib/client_agency_config.rb:16`; `emmy/app/config/client-agency-config.yml:34-36`.
    - [secondary/web]

### G. Evidence report: PDF, JSON, CSV manifest

52. **One PDF template serves both audiences through an `is_caseworker` flag.** The transmitted copy is always the caseworker variant, always in English; the applicant downloads the client variant in their own language.
    - Quote: `is_caseworker: true,` / `PdfService.new(language: :en)` / "caseworkers should receive the report in English"
    - Source: `emmy/app/app/services/pdf_service.rb:25-31`; `emmy/app/app/services/income_transmitter.rb:16-18`; `emmy/app/app/mailers/caseworker_mailer.rb:32-33`; `emmy/app/app/controllers/cbv/submits_controller.rb:35-40`.
    - [secondary/web]

53. **PDF header and framing.** Product name, agency logo or name, title "Income Verification Report", a one-paragraph statement of provenance and consent, and (caseworker only) a "How to use this report" box. Footer on every page.
    - Quote: "The following income information was retrieved with the client's consent and has been submitted by them to their benefits agency. The client is also able to download a client-facing copy of this report." / "Income Verification Report | Page [page] of [topage]"
    - Source: `emmy/app/app/views/cbv/submits/show.pdf.erb:1-34`; `emmy/app/config/locales/en.yml:1185-1188`, `:1202-1204`.
    - [secondary/web]

54. **PDF section "Client and Report Information", table 1 "Client information".** Each configured client-provided attribute (footnoted "Client-provided information"), agency-specific caseworker fields, and the answer to "Reporting any income from work separately?".
    - Quote: `<sup>1</sup><span><%= t(".pdf.caseworker.client_provided_information") %></span>`
    - Source: `emmy/app/app/views/cbv/submits/show.pdf.erb:36-77`; `emmy/app/app/services/client_agency/report_fields.rb:8-12`; `emmy/app/app/services/client_agency/la_ldh/report_fields.rb:2-7` (doc_id, individual_id).
    - (ADDED nuance) The "Reporting any income from work separately?" row is not universal. It is rendered only when a class `ClientAgency::<Agency>::ReportFields` exists (`emmy/app/app/services/client_agency/caseworker_report_specific_field_decider.rb:9-18`). In this commit only `la_ldh` and `sandbox` have one, so the `nh_dhhs` report omits the row even though the answer is collected.
    - [secondary/web]

55. **PDF table 2 "Report details": confirmation code, date the report was created, date range covered, and (caseworker only) the consent timestamp.** The "date created" row is the consent timestamp formatted as a date.
    - Quote: `row.with_data_cell.with_content(t(".pdf.caseworker.agreement_consent_timestamp"))` `row.with_data_cell.with_content(@cbv_flow.consented_to_authorized_use_at)`
    - Source: `emmy/app/app/views/cbv/submits/show.pdf.erb:79-104`; labels `emmy/app/config/locales/en.yml:1179`, `:1198-1199`, `:1209`.
    - (ADDED nuance) The consent-timestamp cell prints the raw attribute with no formatting helper and no explicit time zone (`show.pdf.erb:101`), unlike the "date created" row, which goes through `format_parsed_date` (`:92`). Our pack should print an explicit ISO 8601 UTC timestamp.
    - [secondary/web]

56. **PDF section "Employment and Payment details", repeated per employer ("Employer N: name").** Employment information table: (caseworker only, when identity data synced) client full name as linked to the payroll account and masked SSN; employer phone, address, employment status, start date, end date; pay frequency and compensation amount with unit for W-2 jobs.
    - Quote: `<%= table.with_data_point(:client_full_name, summary[:identity]&.full_name) %>` `<%= table.with_data_point(:ssn, summary[:identity]&.ssn) %>`
    - Source: `emmy/app/app/views/cbv/submits/show.pdf.erb:106-147`.
    - [secondary/web]

57. **SSNs are masked to the last four before they ever reach a report object.**
    - Quote: `"XXX-XX-#{full_ssn.last(4).to_s.rjust(4, "X")}"`
    - Source: `emmy/app/app/services/aggregators/format_methods/argyle.rb:77-80`; Pinwheel equivalent `emmy/app/app/services/aggregators/response_objects/identity.rb:24`.
    - [secondary/web]

58. **Monthly summary table per employer.** Columns: Month (with a "Partial month" note when the window cuts a month), Gross income, Number of paychecks, Total hours worked. Plain-language definitions follow the first table.
    - Quote: `"Gross income" is the pay from your job before taxes, benefits, and deductions are taken out of your paychecks.`
    - Source: `emmy/app/app/components/report/w2_monthly_summary_table_component.html.erb:8-54`; `emmy/app/config/locales/en.yml:1311-1326`; aggregation `emmy/app/app/services/aggregators/aggregator_reports/aggregator_report.rb:153-190`.
    - (ADDED scope note) This table and the per-paystub table in fact 59 are the W-2 branch only. Gig accounts render a different component with no per-paystub tables (`emmy/app/app/views/cbv/submits/show.pdf.erb:149`, `:197-199`); its columns include "Verified mileage expenses" (`emmy/app/config/locales/en.yml:1307`, `:1318-1319`), which is benefits-program content (Deliverable 4b item 5).
    - [secondary/web]

59. **Per-paystub detail table ("Payments and deductions from {employer}").** Rows: pay date; pay period with frequency; payment before taxes (gross); gross pay line items by category; number of hours worked; hours by earning category; payment after taxes and deductions (net); each non-zero deduction with category and tax treatment; gross pay YTD. In the caseworker variant the three decision-relevant rows (pay period, gross, hours) are highlighted.
    - Quote: `<%= table.with_data_point(:pay_gross, paystub.gross_pay_amount, highlight: is_caseworker) %>` / "Key fields for income verification are highlighted in yellow."
    - Source: `emmy/app/app/views/cbv/submits/show.pdf.erb:149-180`; `emmy/app/config/locales/en.yml:1187`; labels `emmy/app/app/components/aggregate_data_point_component.rb:27-103`.
    - [secondary/web]

60. **An empty result is stated positively, not left blank.**
    - Quote: "We've confirmed that there are no recent payments from this employer. This happens when the client hasn't received income from this job."
    - Source: `emmy/app/config/locales/en.yml:1169`; `emmy/app/app/views/cbv/submits/show.pdf.erb:181-196`.
    - [secondary/web]

61. **The applicant's comment for each employer is printed at the end of that employer's section.**
    - Quote: `<p><%= payroll_account.additional_information %></p>`
    - Source: `emmy/app/app/views/cbv/submits/show.pdf.erb:201-206`.
    - [secondary/web]

62. **Money is carried as integer cents and formatted only at the edge.**
    - Quote: `def format_money(dollars_in_cents)` `number_to_currency(dollars_in_cents.to_f / 100)`
    - Source: `emmy/app/app/helpers/report_view_helper.rb:32-34`.
    - [secondary/web]

63. **Income report JSON (machine-readable twin of the PDF), top level:** `confirmation_code`, `completed_at` (the consent timestamp, ISO 8601), `agency_partner_metadata` (the agency's own identifiers, echoed), `income_report`, and optionally `report_pdf` (Base64 PDF).
    - Quote: `completed_at: @cbv_flow.consented_to_authorized_use_at.iso8601,`
    - Source: `emmy/app/app/services/transmitters/json_transmitter.rb:41-61`.
    - [secondary/web]

64. **`income_report` body.** `has_other_jobs` plus `employments[]`, each with `applicant_full_name`, `applicant_ssn` (masked), `applicant_extra_comments`, `employer_name`, `employer_phone`, `employer_address`, `employment_status`, `employment_type`, `employment_start_date`, `employment_end_date`, `pay_frequency`, `compensation_amount`, `compensation_unit`, and `paystubs[]` with `pay_date`, `pay_period_start`, `pay_period_end`, `pay_gross`, `gross_pay_list[] {type, amount}`, `pay_gross_ytd`, `pay_net`, `hours_paid`, `deductions[]`.
    - Quote: `pay_gross: paystub.gross_pay_amount || 0,`
    - Source: `emmy/app/app/services/aggregators/aggregator_reports/aggregator_report.rb:77-126`.
    - [secondary/web]

65. **The newer activity-report JSON adds the structure an evidence pack needs:** a `schema_version` ("1.0.0"), a `review_period`, a `documents[]` list (`document_id`, `document_name`, `file_type`), and on every entry a `data_source` of `self_attested` or `validated` plus `document_ids[]` linking the entry to its uploaded proof.
    - Quote: `"schema_version" => SCHEMA_VERSION,` / `"data_source" => "self_attested",` `"document_ids" => document_ids_for(activity)`
    - Source: `emmy/app/app/services/activity_report_serializer.rb:2`, `:43-56`, `:82-90`, `:130-141`, `:178-186`.
    - [secondary/web]

66. **Schema evolution rule for outbound JSON: add-only within a major version; "soft required" fields are nullable.**
    - Quote: "Fields should only be added to the spec at any time without breaking existing integrations. Fields are only removed in major version releases." / "Fields that should be present but may not always be available from upstream providers are not marked as required, and denote `null` as an acceptable value."
    - Source: `emmy/docs/api/receiving-data/ce-activity-json.md:72-77`.
    - [secondary/web]

67. **The encrypted-bundle delivery includes a one-row CSV manifest beside the PDF.** Columns: `client_id`, `first_name`, `last_name`, `middle_name`, `client_email_address`, `beacon_userid`, `app_date`, `report_date_created`, `confirmation_code`, `consent_timestamp`, `pdf_filename`, `pdf_filetype`, `pdf_filesize`, `pdf_number_of_pages`.
    - Quote: `consent_timestamp: @cbv_flow.consented_to_authorized_use_at.strftime("%m/%d/%Y %H:%M:%S"),` / `pdf_number_of_pages: pdf_output.page_count`
    - Source: `emmy/app/app/services/transmitters/encrypted_s3_transmitter.rb:65-86`.
    - [secondary/web]

68. **Uploaded documents get stable ids and deterministic delivery names.** Id is `DOC-<attachment id>`; filename is `<confirmation code>_<activity type>_<sanitized original name><ext>`, de-duplicated with a numeric suffix.
    - Quote: `"DOC-#{attachment.id}"` / `prefix = [ @activity_flow.confirmation_code, activity.class.activity_type, document_name ].join("_")`
    - Source: `emmy/app/app/services/activity_documents_service.rb:11-15`, `:28`, `:38-49`.
    - [secondary/web]

69. **Emmy's evidence package contains no eligibility decision, no threshold, no file hashes, and no reviewer identity.** It is a data conduit; the agency decides.
    - Quote: "Your state will determine eligibility based on the information you submit."
    - Source: `emmy/app/config/locales/en.yml:489`; no hashing code in report or serializer paths (search of `emmy/app/app/services`, `views`, `models` for sha256/checksum finds only the Pinwheel webhook signature and the upload checksum).
    - [secondary/web]

### H. Transmission to the receiving organization

70. **Six pluggable delivery methods, chosen per agency in config:** `shared_email`, `sftp`, `encrypted_s3`, `json`, `http_pdf`, `json_and_pdf`.
    - Quote: `raise "Unsupported income flow transmission method: #{@current_agency.income_flow_transmission_method}"`
    - Source: `emmy/app/app/jobs/case_worker_transmitter_job.rb:47-64`; `emmy/app/config/client-agency-config.yml:13`, `:114`, `:199`.
    - [secondary/web]

71. **Outbound HTTP deliveries are signed with HMAC-SHA512 of `"<timestamp>:<raw body>"`, keyed with the receiver's API key, in two headers.** PDF posts, supporting-document posts and CE Activity Report posts add an `X-IVAAS-Confirmation-Code` header; the Income Report JSON post does not (the code is in its body instead) (`emmy/docs/api/receiving-data/webhook-signatures.md:11-15`). Receivers are told to verify against the exact bytes with a constant-time compare.
    - Quote: "HMAC-SHA512 hexdigest of `"<timestamp>:<request body>"`, keyed with the agency's API key." (the `X-IVAAS-Signature` row) / "do not parse and reserialize the JSON before checking the signature."
    - Source: `emmy/docs/api/receiving-data/webhook-signatures.md:7-11`, `:25-28`; `emmy/app/app/services/json_api_signature.rb:5-17`; `emmy/app/app/services/transmitters/json_transmitter.rb:11-12`; `emmy/app/app/services/transmitters/http_pdf_transmitter.rb:28-30`.
    - [secondary/web]

72. **Retry policy: five more attempts at 5 minutes, 10 minutes, 30 minutes, 1 hour, 4 hours; then the job stays failed for humans.** One delivery at a time per flow.
    - Quote: `RETRY_WAITS = [ 5.minutes, 10.minutes, 30.minutes, 1.hour, 4.hours ].freeze` / "If the final attempt fails, the job remains failed for investigation by the Emmy team in partnership with your agency's technical team."
    - Source: `emmy/app/app/jobs/case_worker_transmitter_job.rb:8-25`; `emmy/docs/api/receiving-data/retry-logic.md:1-6`.
    - [secondary/web]

73. **Two-part deliveries are made idempotent with a per-part timestamp:** in `json_and_pdf`, a retry skips the JSON if `json_transmitted_at` is already set.
    - Quote: `unless cbv_flow.json_transmitted_at.present?`
    - Source: `emmy/app/app/services/transmitters/json_and_pdf_transmitter.rb:6-11`.
    - [secondary/web]

74. **Success is decided by HTTP status alone; the body is ignored. Selected error codes can be configured to retry quietly; per-receiver custom headers are supported.** (CORRECTED: "any 2xx" is what the docs say and what the PDF and document transmitters do; the income JSON transmitter also accepts 3xx.)
    - Quote (docs): "Emmy uses the HTTP status to determine delivery success and does not validate the response body. The transmitter accepts any `2xx` success status; other statuses cause delivery to fail and trigger a retry."
    - Quote (code, income JSON): `when Net::HTTPSuccess, Net::HTTPRedirection` `@cbv_flow.touch(:json_transmitted_at)`
    - Quote (code, PDF): `unless res.is_a?(Net::HTTPSuccess)`
    - Source: `emmy/docs/api/receiving-data/pdf-transmission.md:52-55`; `emmy/app/app/services/transmitters/json_transmitter.rb:26-32`; `emmy/app/app/services/transmitters/http_pdf_transmitter.rb:44-46`; `emmy/app/app/services/transmitter.rb:22-24`, `:42-55`; `emmy/app/config/client-agency-config.yml:17-23`.
    - Consequence: in Emmy an unfollowed redirect from the JSON receiver is recorded as delivered. Do not copy that; treat only 2xx as success.
    - [secondary/web]

75. **File-based deliveries.** SFTP filename default `CBVPilot_%{consent_date}_Conf%{confirmation_code}` with a per-agency format string; the S3 path gzips a tar of PDF plus CSV and GPG-encrypts it to the agency's public key.
    - Quote: `DEFAULT_PDF_FILENAME_FORMAT = "CBVPilot_%{consent_date}_Conf%{confirmation_code}"` / `s3_service.upload_file(tmp_encrypted_tar.path, "outfiles/#{@file_name}.tar.gz.gpg")`
    - Source: `emmy/app/app/services/transmitters/sftp_transmitter.rb:5`; `emmy/app/app/services/transmitters/pdf_filename_formatter.rb:8-14`; `emmy/app/app/services/transmitters/encrypted_s3_transmitter.rb:25-49`.
    - [secondary/web]

76. **There is an operator fallback for permanently failed deliveries:** preview then email the PDF to a configured fallback address, skipping anything already transmitted and warning when the applicant was already redacted.
    - Quote: `base_entry.merge(status: :skipped, reason: "already transmitted at #{cbv_flow.transmitted_at}")`
    - Source: `emmy/app/app/services/caseworker_mailer_fallback_service.rb:7-34`, `:75-81`, `:122-124`.
    - [secondary/web]

### I. Audit and event logging

77. **Event tracking is an analytics pipeline, not an audit ledger.** Controllers call `event_logger.track(name, request, attrs)`; a background job enriches with device and browser and sends to Mixpanel. A tracking failure never breaks the request in production.
    - Quote: `EventTrackingJob.perform_later(event_type, request_data, merged_attributes)` / `raise unless Rails.env.production?`
    - Source: `emmy/app/lib/generic_event_tracker.rb:4-15`; `emmy/app/app/jobs/event_tracking_job.rb:8-30`; `emmy/app/lib/mixpanel_event_tracker.rb:10-31`.
    - [secondary/web]

78. **Standard attributes on every event:** `time`, `device_id`, `ip`, `cbv_flow_id`, `flow_type`, `client_agency_id`, `locale`, `user_agent`; most call sites add `cbv_applicant_id` and `invitation_id`.
    - Quote: `flow_type: request.session[:flow_type].to_s == "activity" ? "ce" : "income",`
    - Source: `emmy/app/lib/generic_event_tracker.rb:19-35`; `emmy/app/app/controllers/concerns/trackable.rb:10-26`.
    - [secondary/web]

79. **Stated rule: no PII in analytics; PII is coerced to booleans, counts, or ranges first.** (CORRECTED: the original called this a "hard rule". It is a code comment, not an enforced control, and the code around it sends several identifying or quasi-identifying values.)
    - Quote: "**Important Note**: We do not send PII to our analytics platforms! As such, any field here that deals with PII should coerce it into a boolean (with `#present?`) or perform a function to anonymize the value (like `length`) before sending it to the event logger."
    - Source: `emmy/app/app/controllers/webhooks/argyle/events_controller.rb:217-224`; same note `emmy/app/app/controllers/webhooks/pinwheel/events_controller.rb:96-103`.
    - Values that are nevertheless sent to the analytics pipeline in this commit: the client IP address and user agent on every request-bound event (`emmy/app/lib/generic_event_tracker.rb:26`, `:31`; `emmy/app/lib/mixpanel_event_tracker.rb:17`); the ZIP code and the rail account id from the identity record (`identity_zip_code`, `identity_account_id`, `emmy/app/app/controllers/webhooks/argyle/events_controller.rb:236`, `:238`; Pinwheel `:115`, `:117`); the inviting service account's email address (`caseworker_email_address`, `emmy/app/app/services/cbv_invitation_service.rb:49`); and the confirmation code (`emmy/app/app/jobs/case_worker_transmitter_job.rb:72`). Take the principle from Emmy, not the implementation: enforce it with an allow-list of event attributes.
    - [secondary/web]

80. **Event names are kept in one catalogue (`TrackEvent` constants), and the browser-side endpoint rejects names that are not in it. Server-side code is not held to the catalogue.** (CORRECTED: the original called the catalogue "closed". At least two event names are passed as bare string literals and are not `TrackEvent` constants: `ApplicantAccessedSuccessPage` at `emmy/app/app/controllers/cbv/successes_controller.rb:20`, and `DataRedactionFailure` at `emmy/app/app/models/payroll_account/argyle.rb:102`. The catalogue file is 163 lines, not 81; `EmailSent` is at line 111.) Flow-relevant names, in lifecycle order: `CaseworkerInvitedApplicantToFlow`, `ApplicantClickedCBVInvitationLink`, `ApplicantClickedGenericLink`, `ApplicantAccessedExpiredLinkPage`, `ApplicantAccessedFlowWithoutCookie`, `CbvPageView`, `ApplicantViewedAgreement`, `ApplicantConsentedToTerms`, `ApplicantAgreed`, `ApplicantAccessedSearchPage`, `ApplicantSearchedForEmployer`, `ApplicantSelectedEmployerOrPlatformItem`, `ApplicantBeganLinkingEmployer`, `ApplicantAttemptedArgyleLogin`, `ApplicantSucceededWithArgyleLogin`, `ApplicantCreatedArgyleAccount`, `ApplicantReceivedArgyleData`, `ApplicantFinishedArgyleSync`, `ApplicantReportMetUsefulRequirements`, `ApplicantReportFailedUsefulRequirements`, `ApplicantViewedPaymentDetails`, `ApplicantSavedPaymentDetails`, `ApplicantContinuedFromAddJobsPage`, `ApplicantContinuedFromOtherJobsPage`, `ApplicantAccessedMissingResultsPage`, `ApplicantAccessedIncomeSummary`, `ApplicantAccessedSubmitPage`, `ApplicantSharedIncomeSummary`, `ApplicantAccessedSuccessPage`, `ApplicantDownloadedIncomePDF`, `ApplicantWarnedAboutTimeout`, `ApplicantExtendedSession`, `ApplicantEndedSession`, `ApplicantTimedOut`, `ApplicantManuallySwitchedLanguage`, `ApplicantOpenedHelpModal`, `EmailSent`, plus a family of `ApplicantEncounteredArgyle...Error` names.
    - Quote: `if TrackEvent.constants.map(&:to_s).include?(event_name)` ... `raise "Unknown Event Type #{event_name.inspect}"`
    - Source: `emmy/app/app/models/track_event.rb:3-163`; `emmy/app/app/controllers/api/user_events_controller.rb:21-29`. Every name in the list above was checked against the constants file; all are constants except `ApplicantAccessedSuccessPage` (string literal, see above).
    - [secondary/web]

81. **Redaction failures are themselves an event.**
    - Quote: `GenericEventTracker.new.track("DataRedactionFailure", nil, { account_id: aggregator_account_id })`
    - Source: `emmy/app/app/models/payroll_account/argyle.rb:97-102`.
    - [secondary/web]

82. **Sensitive parameters are filtered out of application logs by name.**
    - Quote: `:passw, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn,` ... `:email_address, :case_number, :first_name, :middle_name, :last_name,`
    - Source: `emmy/app/config/initializers/filter_parameter_logging.rb:6-17`.
    - [secondary/web]

83. **Structured log lines are tagged with flow context when enabled.**
    - Quote: `flow_id: @flow.id,` `flow_type: @flow.class.name,` `invitation_id: @flow.invitation_id,` `cbv_applicant_id: @flow.cbv_applicant_id,`
    - Source: `emmy/app/app/controllers/cbv/base_controller.rb:60-75`.
    - [secondary/web]

### J. Retention and redaction

84. **Retention windows are three named constants, all 7 days.**
    - Quote: "Redact invitations 7 days after they expire" `REDACT_UNUSED_INVITATIONS_AFTER = 7.days` / "Redact transmitted Income and CE flows 7 days after they are sent to caseworker" `REDACT_TRANSMITTED_CBV_FLOWS_AFTER = 7.days`
    - Source: `emmy/app/app/services/data_retention_service.rb:4-11`.
    - [secondary/web]

85. **One daily scheduled task runs every redaction rule in a fixed order.**
    - Quote: `["bin/rails", "data_deletion:redact_all"]` / `"cron(0 14 ? * * *)" # Every day at 2pm UTC (9am EST / 10am EDT)`
    - Source: `emmy/infra/app/app-config/env-config/scheduled_jobs.tf:12-15`; `emmy/app/lib/tasks/data_deletion.rake:3-6`; order `emmy/app/app/services/data_retention_service.rb:13-22`.
    - [secondary/web]

86. **Redaction overwrites, it does not delete rows.** Each model declares its redactable fields with a type; the type picks a sentinel replacement; `redacted_at` is stamped; validations are skipped. Scopes `redacted` and `unredacted` exist on every such model.
    - Quote: `string: "REDACTED",` `date: Date.new(1990, 1, 1),` `email: "REDACTED@example.com",` `object: {},` `uuid: "00000000-0000-0000-0000-000000000000",`
    - Source: `emmy/app/app/models/concerns/redactable.rb:19-28`, `:30-33`, `:47-58`.
    - [secondary/web]

87. **What survives redaction on an income flow:** the row itself, `confirmation_code`, `consented_to_authorized_use_at`, `transmitted_at`, and foreign keys. Only `end_user_id` is overwritten on `CbvFlow`; the invitation loses its email; the applicant loses the per-agency configured fields.
    - Quote: `end_user_id: :uuid` (the only entry in `CbvFlow`'s `has_redactable_fields`) / `email_address: :email` (the only entry on the invitation)
    - Source: `emmy/app/app/models/cbv_flow.rb:8-11`; `emmy/app/app/models/cbv_flow_invitation.rb:40-43`; `emmy/app/app/models/cbv_applicant.rb:97-99`; `emmy/app/lib/client_agency_config.rb:196-204`.
    - (CORRECTED scope) **What is left after redaction is not guaranteed to be non-identifying.** Also surviving, because they are not in any redactable-field list: on the flow, `device_id`, `argyle_user_id`, `pinwheel_token_id`, `has_other_jobs` and the `additional_information` jsonb (`emmy/app/db/schema.rb:172-191`); on the invitation, the `auth_token` itself (the unique index simply stops applying once `redacted_at` is set, `emmy/app/db/schema.rb:167`); on the applicant, every configured attribute that has no `redaction_type`. In this commit that includes `case_number` for `nh_dhhs` and `sandbox` (`emmy/app/config/client-agency-config.yml:154-155`, `:240-241`) and `doc_id` and `individual_id` for `la_ldh` (`:63-64`, `:73-74`), because only attributes with a `redaction_type` are collected (`emmy/app/lib/client_agency_config.rb:200`). Case numbers are handled by a separate operator command, `DataRetentionService.redact_case_numbers_by_agency` (`emmy/app/app/services/data_retention_service.rb:197-203`).
    - [secondary/web]

88. **Rule: unused or abandoned work is redacted 7 days after the invitation expires; a flow with no invitation, 7 days after its last update.**
    - Quote: "Although the CbvFlow is not updated on every page, sessions time out after 30 minutes, so it would be extremely unlikely for a valid session to still be in progress after 7 days."
    - Source: `emmy/app/app/services/data_retention_service.rb:24-67`.
    - [secondary/web]

89. **Rule: a completed flow is redacted 7 days after `transmitted_at`.** A flow that never transmitted successfully is therefore not redacted by this rule.
    - Quote: `.where("transmitted_at < ?", REDACT_TRANSMITTED_CBV_FLOWS_AFTER.ago)`
    - Source: `emmy/app/app/services/data_retention_service.rb:69-79`.
    - (ADDED, stronger) **A submitted income flow whose delivery never succeeds is not redacted by any scheduled rule.** The "incomplete" rule selects only flows with no confirmation code (`CbvFlow.incomplete`, `emmy/app/app/models/cbv_flow.rb:5`; used at `data_retention_service.rb:36-41`), and the "complete" rule needs a non-null `transmitted_at`. A flow that has a confirmation code and a null `transmitted_at` matches neither. The invitation rule still overwrites the invitation's email after expiry plus 7 days, but it redacts the applicant only when the invitation has no flows (`data_retention_service.rb:32`). Such a record waits for the operator fallback (fact 76), which stamps `transmitted_at` and so starts the 7-day clock. This is a retention gap to design out: give every state a terminal retention rule.
    - [secondary/web]

90. **Shared parent records are redacted only when nothing live still points at them.**
    - Quote: `return if applicant.cbv_flow_invitations.unredacted.where("expires_at >= ?", Time.current).exists?` `return if applicant.cbv_flows.unredacted.exists?`
    - Source: `emmy/app/app/services/data_retention_service.rb:261-270`; household equivalent `:207-217`.
    - [secondary/web]

91. **Redaction reaches into the vendor for Argyle only: the Argyle account is deleted through Argyle's API as part of redaction.** Already-deleted is treated as success. (CORRECTED scope: the original did not say this is Argyle-only.)
    - Quote: `argyle.delete_account_api(account: aggregator_account_id)` `rescue Faraday::ResourceNotFound` "Account already deleted on Argyle's side"
    - Source: `emmy/app/app/models/payroll_account/argyle.rb:76-96`.
    - **Pinwheel accounts are not deleted at the vendor.** `PayrollAccount::Pinwheel` uses the generic `Redactable` behaviour and only overwrites the applicant's comment (`has_redactable_fields(additional_information: :string)`, `emmy/app/app/models/payroll_account/pinwheel.rb:12-15`). No Pinwheel deletion call exists in the redaction path.
    - Failure handling for Argyle: in production a failed vendor deletion is logged, reported to New Relic and tracked (fact 81), and the account row is left without a `redacted_at` stamp (`payroll_account/argyle.rb:93-103`); outside production it raises. The scheduled job does not come back to it: for income flows the parent flow is stamped redacted before its accounts are processed (`emmy/app/app/services/data_retention_service.rb:48-51`, `:62-64`, `:75-77`), and every income rule selects only unredacted flows, so a failed vendor deletion is left for a human to follow up from the alert. A dated, temporary exception skips 403 errors for accounts created on or before 2026-09-23 (`payroll_account/argyle.rb:4-8`, `:82-90`); that is an Emmy migration artifact, not a pattern.
    - [secondary/web]

92. **Uploaded documents are purged from storage 7 days after successful delivery, and the flow is stamped `documents_deleted_at` only if every file was deleted.**
    - Quote: `.where("transmitted_at < ?", REDACT_ACTIVITY_FLOW_SUMMARIES_AFTER.ago)` / `"Did not mark documents deleted for activity_flow_id=#{activity_flow.id} " \`
    - Source: `emmy/app/app/services/data_retention_service.rb:163-175`, `:219-251`.
    - UNVERIFIED (which bucket is emptied): the purge calls `attachment.purge` on attachments whose blobs are registered against the "unscanned" storage service (`emmy/app/app/models/concerns/document_uploadable.rb:6`; `emmy/app/app/services/presigned_upload_service.rb:4`, `:62`), while delivery reads the same key from the separate "processed" bucket (`emmy/app/app/services/transmitters/http_document_transmitter.rb:18`). This repository contains no code that deletes objects from the processed bucket (search for `ProcessedDownloadService`, `:processed`, `PROCESSED_BUCKET` finds only the download path and the storage config). Whether the processed copy is removed, and by what, is NOT IN SOURCES (presumably the separate `emmy-infra` repository). For our build: a purge job must delete from every bucket that holds a copy, and prove it.
    - [secondary/web]

93. **Hourly janitors remove orphans:** uploads never attached to anything after 24 hours; draft records after 24 hours; finished background jobs hourly.
    - Quote: `CUTOFF = 24.hours` / `schedule: every hour`
    - Source: `emmy/app/app/jobs/unattached_upload_cleanup_job.rb:2`; `emmy/app/app/jobs/draft_cleanup_job.rb:2`; `emmy/app/config/recurring.yml:2-13`.
    - [secondary/web]

94. **There is a manual, per-person redaction entry point for operators.**
    - Quote: "Use after conducting a user test or other time we want to manually redact a specific person's data in the system."
    - Source: `emmy/app/app/services/data_retention_service.rb:177-195`.
    - [secondary/web]

95. **A redacted applicant on a flow that is about to transmit triggers an error report, and then Emmy transmits anyway.** (CORRECTED: the original said Emmy alerts "rather than silently sending REDACTED". The code does not stop.)
    - Quote: `if @cbv_flow.cbv_applicant&.redacted_at.present?` `NewRelic::Agent.notice_error(` `RedactedApplicantError.new("Transmitting cbv_flow #{cbv_flow_id} with redacted applicant #{@cbv_flow.cbv_applicant_id}")` `)` `end` ... `transmitter_class.new(@cbv_flow, @current_agency, aggregator_report).deliver` `@cbv_flow.touch(:transmitted_at)`
    - Source: `emmy/app/app/jobs/case_worker_transmitter_job.rb:32-41`.
    - The error object is passed to `NewRelic::Agent.notice_error`; it is not raised. Execution continues to fetch the report, deliver it and stamp `transmitted_at`. So Emmy's behaviour is "report, then send the redacted record". Stopping the delivery is our requirement, not Emmy's (implication 25).
    - [secondary/web]

### K. Document upload (activity flow)

96. **Uploads go browser-to-bucket with a presigned POST into an "unscanned" bucket; the app reads only from a separate "processed" bucket.** The presign pins the exact byte size and content type and expires in 15 minutes. The client supplies a SHA-256 checksum, validated for shape.
    - Quote: `content_length_range: byte_size..byte_size,` `signature_expiration: POLICY_TTL.from_now` / `POLICY_TTL = 15.minutes`
    - Source: `emmy/app/app/services/presigned_upload_service.rb:4-6`, `:67-72`, `:78-86`; `emmy/app/config/storage.yml:13-19`; `emmy/app/app/services/processed_download_service.rb:2`; `emmy/app/app/javascript/utilities/file_checksum.js:1-5`.
    - (ADDED limits) "Validated for shape" is all that happens here: the server checks that the checksum looks like a Base64 SHA-256 (`CHECKSUM_FORMAT`, `presigned_upload_service.rb:5`, `:71`) and stores it on the blob record (`:61`), but the presigned POST carries no checksum condition (`:78-86`), and nothing in this repository compares the uploaded bytes with it. Do not treat Emmy's stored checksum as a verified file hash. "The app reads only from the processed bucket" is true of delivery (`emmy/app/app/services/transmitters/http_document_transmitter.rb:9`, `:18`; `activity_s3_transmitter.rb:11`); the scanner that moves files between buckets is not in this repository (Open Question 6). In local development both names point at the same unscanned disk directory (`emmy/app/config/storage.yml:21-30`).
    - [secondary/web]

97. **Server-side upload validation: allowed types, max size, non-empty, checksum format.** Allowed types here are pdf, png, jpeg, bmp, tiff; the cap is 40 MB.
    - Quote: `raise UnacceptableUpload, :unsupported_type unless client_agency.allowed_document_content_types.include?(file[:content_type])`
    - Source: `emmy/app/app/services/presigned_upload_service.rb:67-72`; `emmy/app/lib/client_agency_config.rb:21-31`.
    - [secondary/web]

98. **Upload error copy is specific and tells the person what to do.**
    - Quote: "That file is empty. Choose a different file." / "Each file must be smaller than %{limit}." / "We could not upload that file. Check your connection and try again."
    - Source: `emmy/app/config/locales/en.yml:194-199`.
    - [secondary/web]

99. **The upload page lists suggested documents per item type.**
    - Quote: `suggestion_title: Suggested supporting documents` / "<ul><li>Tuition receipt</li><li>Student portal screenshot</li>..."
    - Source: `emmy/app/config/locales/en.yml:190-191`, `:146`; hooks `emmy/app/app/models/concerns/document_uploadable.rb:43-50`.
    - [secondary/web]

### L. Accessibility, plain language, i18n

100. **English and Spanish; locale is an optional URL prefix, remembered in the session, with English fallback.** The invitation carries the person's `language`, and the tokenized URL is built with that locale.
     - Quote: `config.i18n.available_locales = [ :en, :es ]` / `scope "(:locale)", locale: /#{I18n.available_locales.join("|")}/, format: "html" do`
     - Source: `emmy/app/config/application.rb:26-27`; `emmy/app/config/routes.rb:4`; `emmy/app/app/controllers/application_controller.rb:20-24`, `:260-269`; `emmy/app/app/models/cbv_flow_invitation.rb:63-71`.
     - [secondary/web]

101. **Missing translations are a tracked, enumerated exception list, not an accident.** For example the whole newer activity flow (`activities.*`) and caseworker PDF labels are explicitly listed as not translated to Spanish.
     - Quote: `- "activities.*"` / `- "cbv.submits.show.pdf.caseworker.*"`
     - Source: `emmy/app/config/i18n-tasks.yml:140`, `:145`.
     - [secondary/web]

102. **Per-tenant copy overrides use one helper: look up `<key>.<agency id>`, else `<key>.default`.** HTML keys get their interpolated values escaped.
     - Quote: `default_key = "#{i18n_base_key}.default"` / `options[name] = ERB::Util.html_escape(value.to_s)`
     - Source: `emmy/app/app/helpers/application_helper.rb:64-86`; example `emmy/app/config/locales/en.yml:1087-1089`.
     - [secondary/web]

103. **Accessibility basics are in the layout and tested:** `lang` on `<html>`, a skip link, a single `<main>`, labelled modals, captions on every table, screen-reader-only labels, and `axe` matchers in the test suite.
     - Quote: `<html lang="<%= I18n.locale %>">` / `<a class="usa-skipnav" href="#main-content">` / `raise ArgumentError, "caption is required" if caption.blank?`
     - Source: `emmy/app/app/views/layouts/application.html.erb:2`, `:14`, `:19`; `emmy/app/app/components/table_component.rb:21`; `emmy/app/app/views/cbv/sessions/_timeout_modal.html.erb:7-8`; `emmy/app/spec/rails_helper.rb:13`; `emmy/app/Gemfile:128`.
     - [secondary/web]

104. **Plain-language habits worth copying:** numbered "how it works" steps on the first screen, a time estimate, "Common questions" accordions, help topics written as the person's own sentence ("I don't feel comfortable entering my login credentials"), and definitions under every summary table.
     - Quote: "<strong>Most people complete this process in about 5 minutes.</strong> Just follow these steps:"
     - Source: `emmy/app/config/locales/en.yml:1085`, `:1340-1378`, `:1321-1323`; `emmy/app/app/views/cbv/entries/show.html.erb:8-21`, `:32-69`.
     - [secondary/web]

105. **Screen changes are treated as breaking changes for versioning purposes.**
     - Quote: "**Could a state's existing training material now mislead someone?** If yes, it's MAJOR — regardless of how small the code change was."
     - Source: `emmy/docs/versioning.md:49-52`.
     - (ADDED nuance) Emmy is at 0.x (`emmy/app/version.txt`: 0.16.0), and its own doc says "During the pilot the rubric shifts one position left, so **the middle digit is the notification trigger**" (`emmy/docs/versioning.md:60-61`). So today a screen change bumps Emmy's middle digit, not the first.
     - [secondary/web]

### M. Embedding and operations

106. **Iframe embedding is opt-in per tenant with an origin allow-list.** For those tenants only, Emmy sets CSP `frame-ancestors`, drops `X-Frame-Options`, and reissues session and device cookies as `SameSite=None; Secure` (HTTPS only).
     - Quote: "Scope this relaxation to agencies that opt in to embedding so other agencies keep the stricter `SameSite=Lax` default."
     - Source: `emmy/app/app/controllers/application_controller.rb:40-81`; `emmy/app/config/client-agency-config.yml:254-257`.
     - [secondary/web]

107. **Operational kill switches are environment flags, no deploy needed:** maintenance page, technical-difficulties page, sync-delay banner, and a bilingual site alert.
     - Quote: `ENV.fetch("ENABLED_ALERTS", "none").split(",").map(&:strip)`
     - Source: `emmy/app/app/controllers/application_controller.rb:215-256`.
     - [secondary/web]

108. **An internal-only "launcher" creates demo flows in non-production environments.**
     - Quote: `if Rails.application.config.is_internal_environment` ... `to: "launcher#launcher"`
     - Source: `emmy/app/config/routes.rb:175-182`.
     - [secondary/web]

109. **Closing the rail modal without connecting is a soft state, not an error.** The page stays on employer search, shows a "need help connecting?" banner, re-enables the buttons, and returns keyboard focus to the control the person last used. A successful connect submits the account id to the waiting page. If the rail's link token expires while the modal is open, the page fetches a fresh one.
     - Quote: `this.showHelpBanner()` / `this.lastFocusedElement.focus()` / `await trackUserAction("ApplicantEncounteredArgyleTokenExpired")`
     - Source: `emmy/app/app/javascript/controllers/cbv/employer_search.js:43-46`, `:67-74`; `emmy/app/app/javascript/adapters/ArgyleModalAdapter.ts:152-156`; banner copy `emmy/app/config/locales/en.yml:1027-1029`.
     - [secondary/web]

### N. Added by the fact-check (omissions in the original)

110. **(ADDED) The activity flow, which this file names as the model for our upload path, records its attestation differently from the income flow.** Its submit requires a `consent_to_submit` checkbox, then generates the confirmation code, stamps `completed_at` and enqueues delivery inside one database transaction. There is no `consented_to_authorized_use_at` column on `activity_flows`; `completed_at` is the only attestation-time field, and a repeat submit moves it forward (`touch`). Delivery is enqueued only when the flow came from an invitation.
     - Quote: `unless params.dig(:activity_flow, :consent_to_submit) == "1"` / `@flow.transaction do` `ensure_confirmation_code` `mark_as_completed` `enqueue_transmission` `end` / `@flow.completed_at.nil? ? @flow.update!(completed_at: Time.zone.now) : @flow.touch(:completed_at)` / `return if @flow.activity_flow_invitation_id.blank?`
     - Source: `emmy/app/app/controllers/activities/summary_controller.rb:10-62`; columns `emmy/app/db/schema.rb:102-125`; JSON `"completed_at" => @activity_flow.completed_at&.utc&.iso8601` at `emmy/app/app/services/activity_report_serializer.rb:47`.
     - Reuse: the single transaction around code, timestamp and enqueue (better than the income flow, fact 32). Do not reuse: an attestation timestamp that is overwritten on resubmit; ours must be append-only.
     - [secondary/web]

111. **(ADDED) Uploaded supporting documents are delivered one per HTTP POST as raw bytes, each with its own id header.** Headers: `Content-Type` (the blob's type, else `application/octet-stream`), `Content-Length`, `Content-Disposition: attachment; filename="<delivery name>"`, `X-IVAAS-Document-Id` (matching `document_id` in the JSON, fact 65 and 68), `X-IVAAS-Timestamp`, `X-IVAAS-Signature` (computed over the document bytes), `X-IVAAS-Confirmation-Code`, plus any per-receiver custom headers. Any non-2xx fails the whole job, which then retries (fact 72).
     - Quote: `request["Content-Disposition"] = %(attachment; filename="#{document.file_name}")` `request["X-IVAAS-Document-Id"] = document.document_id` `request["X-IVAAS-Timestamp"] = timestamp` `request["X-IVAAS-Signature"] = signature(content)` `request["X-IVAAS-Confirmation-Code"] = @activity_flow.confirmation_code`
     - Source: `emmy/app/app/services/transmitters/http_document_transmitter.rb:32-44`, `:57-59`; receiver contract `emmy/docs/api/receiving-data/pdf-transmission.md:14-48`.
     - Note: a retry re-sends every document from the first one; this transmitter keeps no per-document delivered stamp (contrast fact 73).
     - [secondary/web]

112. **(ADDED) Field-level encryption is used for exactly one column: the API key.** `encrypts` appears once in the models (`ApiAccessToken#access_token`). Applicant names, dates of birth, case numbers and invitation email addresses are ordinary columns. Protection at rest comes from the database instance: the Terraform sets `storage_encrypted = true` with a KMS key.
     - Quote: `encrypts :access_token, deterministic: true` / `storage_encrypted           = true` `kms_key_id                  = aws_kms_key.db.arn`
     - Source: `emmy/app/app/models/api_access_token.rb:4` (search of `emmy/app/app/models` for `encrypts ` returns only this line); `emmy/infra/modules/database/main.tf:34-35`.
     - Whether the deployed Emmy environments match this Terraform is NOT IN SOURCES. Whether we need field-level encryption for family PII is a decision for the security memo (spec frame_1.txt:276), not something Emmy settles.
     - [secondary/web]

113. **(ADDED) The application has no request rate limiting, and the infrastructure template still lists a WAF as a TODO.** No `rack-attack` (or any throttle) appears in the Gemfile, config or controllers. The load-balancer Terraform carries the comment below. Combined with a 10-character reusable link token (fact 16), this is a reason not to copy Emmy's token design.
     - Quote: "TODO(https://github.com/navapbc/template-infra/issues/165) Protect ALB with WAF" / `# checkov:skip=CKV2_AWS_28:Implement WAF in issue #165`
     - Source: `emmy/infra/modules/service/load-balancer.tf:21-22`; negative search of `emmy/app/Gemfile`, `emmy/app/Gemfile.lock`, `emmy/app/config`, `emmy/app/app/controllers` for `rack-attack`, `rate_limit`, `throttle`.
     - UNVERIFIED: whether CMS runs a WAF or rate limit in front of production by other means. The repository does not say.
     - [secondary/web]

114. **(ADDED) Operators see queued and failed background jobs in a job dashboard mounted at `/jobs`, behind HTTP basic auth read from environment variables.** This is where permanently failed deliveries (fact 72, 76) are visible.
     - Quote: `mount MissionControl::Jobs::Engine, at: "/jobs"` / `MissionControl::Jobs.http_basic_auth_user = ENV["MISSION_CONTROL_USER"]`
     - Source: `emmy/app/config/routes.rb:170`; `emmy/app/config/initializers/mission_control.rb:1-6`.
     - [secondary/web]

115. **(ADDED) A second invitation API (V2) returns two links from one call: the income link and an activity-flow link.** The path segment picks the activity variant (`employment` or `community-engagement`); `verification_range` (`last_complete_month` or `last_12_complete_months`) sets the activity reporting window.
     - Quote: "Direct the applicant to `tokenized_url` to complete income verification, and to `activity_tokenized_url` to complete the corresponding activity flow. Treat both tokens as opaque."
     - Source: `emmy/docs/api/invitations-v2.md:1-15`; routes `emmy/app/config/routes.rb:151-155`; allowed ranges `emmy/app/app/models/flow.rb:6`.
     - The reporting windows are Medicaid policy (Deliverable 4b item 1). The reusable idea is only "one create call can return more than one scoped link".
     - [secondary/web]

116. **(ADDED) The activity-flow delivery job mirrors the income one: same retry ladder, one execution per flow, and `transmitted_at` stamped only after the transmitter returns.** Three methods: an S3 bundle, HTTP documents (fact 111) and a JSON report.
     - Quote: `RETRY_WAITS = [ 5.minutes, 10.minutes, 30.minutes, 1.hour, 4.hours ].freeze` / `transmitter_class(transmission_method).new(activity_flow, current_agency).deliver` `activity_flow.touch(:transmitted_at)`
     - Source: `emmy/app/app/jobs/activity_flow_transmitter_job.rb:4-27`, `:31-42`.
     - [secondary/web]

---

## DELIVERABLE 1. State diagram of Emmy's applicant flow (text)

Emmy has no state-machine library and no status column (fact 5). The diagram below is reconstructed from
the navigator (fact 30), the controller guards, and the timestamps. Names in CAPS are pages; names in
`code` are persisted fields.

```
INVITATION (cbv_flow_invitations)                                   derived states, fact 7, 17, 18
  created ──(agency: POST /api/v1/invitations → tokenized_url, expiration_date)──▶ unstarted
  unstarted ──(link clicked)──▶ started (≥1 flow)
  started ──(any flow gets confirmation_code)──▶ complete
  any ──(now > expires_at | DELETE /api/v1/income/invitations/:token)──▶ expired
  expired ──(+7 days, daily job)──▶ redacted (redacted_at set; counts as expired)

LINK CLICK  GET /{locale}/start/:token      or      GET /cbv/links/:agency (generic, no invitation)
  ├─ token unknown ───────────────▶ HOME + error "The invitation link used is not valid..."
  ├─ invitation expired/redacted ─▶ EXPIRED_INVITATION page          [event ApplicantAccessedExpiredLinkPage]
  ├─ deep link, no session cookie ▶ HOME + "Your session has timed out..." [ApplicantAccessedFlowWithoutCookie]
  └─ ok ─▶ NEW flow row + session{flow_id}                           [ApplicantClickedCBVInvitationLink]
            │
            ▼
ENTRY  /cbv/entry      steps 1-2-3, FAQ, agreement checkbox          [ApplicantViewedAgreement]
  ├─ continue without tick ─▶ ENTRY + "You must check the agreement checkbox to proceed."
  └─ tick + continue ───────▶ EMPLOYER_SEARCH                        [ApplicantConsentedToTerms, ApplicantAgreed]
            │                 (consent #1: NOT persisted)
            ▼
EMPLOYER_SEARCH  /cbv/employer_search
  ├─ search timeout ────────▶ EMPLOYER_SEARCH + "Search timed out. Please try again."
  ├─ "can't find my employer" ▶ MISSING_RESULTS ─▶ back to search | continue ─▶ OTHER_JOB
  └─ pick employer ─▶ server issues rail token ─▶ rail modal (login, MFA)   [ApplicantBeganLinkingEmployer]
        ├─ modal closed / login error ─▶ stays on EMPLOYER_SEARCH + help banner, focus restored (fact 109)
        └─ modal success ─▶ SYNCHRONIZATIONS
            │
            ▼
SYNCHRONIZATIONS  /cbv/synchronizations?user[account_id]   poll every 2 s; session timeout OFF
  PayrollAccount.synchronization_status:  unknown ─▶ in_progress ─▶ succeeded | failed
  per-job status (from webhook_events):   in_progress ─▶ succeeded | failed   (or unsupported)
  ├─ accounts job failed (provider system_error) ─▶ SYNCHRONIZATION_FAILURES
  ├─ account belongs to a different flow (new tab) ▶ SYNCHRONIZATION_FAILURES
  ├─ all supported jobs reported ─▶ PAYMENT_DETAILS
  └─ otherwise keep polling (delay banner after 5 min)

SYNCHRONIZATION_FAILURES  ─▶ retry same employer | add a different job | go to agency website

PAYMENT_DETAILS  /cbv/payment_details?user[account_id]     review one employer + optional comment
  ├─ account not on this flow ─▶ ENTRY + "We weren't able to load payroll data for this account..."
  ├─ report fails "useful report" check ─▶ SYNCHRONIZATION_FAILURES
  └─ continue ─▶ ADD_JOB                                             [ApplicantSavedPaymentDetails]

ADD_JOB  /cbv/add_job   "Do you have another job to add?"            guard: ≥1 succeeded account
  ├─ no answer ─▶ ADD_JOB + "You must select an answer to continue."
  ├─ yes ─▶ EMPLOYER_SEARCH (loop)
  └─ no  ─▶ OTHER_JOB

OTHER_JOB  /cbv/other_job   "Do you need to report other income from your work?"  ─▶ `has_other_jobs`
  └─▶ APPLICANT_INFORMATION

APPLICANT_INFORMATION  /cbv/applicant_information
  ├─ invitation flow, or nothing missing ─▶ (skipped) SUMMARY
  └─ generic-link flow ─▶ form (validation errors re-render) ─▶ SUMMARY

SUMMARY  /cbv/summary    whole report, "Edit" links back to earlier steps ─▶ SUBMIT

SUBMIT  /cbv/submit      "Legal agreement" checkbox
  ├─ submit without tick ─▶ SUBMIT + "Please check the box to continue"
  └─ tick + submit ─▶ `consented_to_authorized_use_at` = now          (consent #2: persisted)
                      `confirmation_code` generated  ⇒ flow is COMPLETE
                      transmit job queued ─▶ SUCCESS

SUCCESS  /cbv/success    confirmation code, Download my report (GET /cbv/submit.pdf), what's next
  (any other flow page now redirects here; pages are no-store)

BACKGROUND
  transmit job ─▶ delivered: `transmitted_at` set                    [ApplicantSharedIncomeSummary]
             └─▶ fails: retry +5m, +10m, +30m, +1h, +4h ─▶ stays failed ─▶ operator fallback email
                 (a submitted-but-never-delivered flow has NO scheduled redaction rule, fact 89)
  retention    ─▶ `transmitted_at` + 7 days: `redacted_at` set; Argyle account deleted at vendor
                 (Pinwheel accounts are not deleted at the vendor, fact 91)

SESSION (orthogonal, every page except SYNCHRONIZATIONS)
  active ──(25 min idle)──▶ WARNING modal ──"Yes, extend my session"──▶ active
                                         └─"End session" | 30 min ──▶ TIMEOUT page ─▶ restart with same link (new flow)
```

---

## DELIVERABLE 2. Evidence report structure

### 2a. Emmy's income PDF (caseworker variant), as built

1. Header: product name, agency logo or name. Title: "Income Verification Report". Footer: title plus "Page x of y". (fact 53)
2. Provenance and consent sentence; "How to use this report" box. (fact 53)
3. Client and Report Information
   1. Client information: client-provided fields with a footnote marker; agency-specific identifiers; "Reporting any income from work separately?" yes/no. (fact 54)
   2. Report details: confirmation code; date created; date range covered; agreement consent timestamp. (fact 55)
4. Employment and Payment details, once per employer (fact 56 to 61)
   1. Employment information: name on the payroll account, masked SSN, employer phone and address, status, start and end dates, pay frequency, compensation rate.
   2. Monthly summary: month, gross income, number of paychecks, total hours; definitions.
   3. Payments and deductions: one table per paystub (pay date, pay period, gross, gross line items, hours, net, deductions, gross YTD), key rows highlighted.
   4. Explicit "no payments found" statement when empty.
   5. The applicant's own comment.

### 2b. Emmy's machine-readable artifacts

- Income JSON: fact 63, 64. Activity JSON with `schema_version`, `data_source`, `documents[]`, `document_ids[]`: fact 65.
- CSV manifest with consent timestamp and PDF name, type, size, page count: fact 67.
- Transport signature (HMAC over timestamp plus body): fact 71.

### 2c. Mapping to our evidence pack (spec frame_1.txt:237). "Emmy" = can be modelled on Emmy; "NEW" = Emmy has nothing comparable

| Our pack element (spec frame_1.txt:237) | Emmy counterpart | Status |
| :-- | :-- | :-- |
| Header, title, page footer, provenance sentence | PDF header and description (fact 53) | Emmy |
| Verification id shown to family and SGO | Confirmation code (fact 35) | Emmy |
| Decision (eligible, ineligible, needs_review) | none (fact 69) | NEW |
| Method (direct, categorical) | nearest is `data_source` self_attested vs validated (fact 65) | NEW, pattern from Emmy |
| Household size, household members | none; Emmy is per individual (fact 12 is a launcher only) | NEW |
| Area, threshold used, threshold source and effective date, provisional label | none | NEW |
| Relevant extracted fields | employment table, monthly summary, per-paystub table (fact 56 to 59) | Emmy |
| Period covered | "Date range for the income report" (fact 55) | Emmy (change the range rule) |
| Consent record (version and timestamp) | timestamp only (fact 32, 33, 55) | Emmy plus NEW (version, text hash, locale) |
| Document or rail identifiers | `aggregator_account_id`, `DOC-<id>`, `document_ids[]` (fact 8, 65, 68) | Emmy |
| File hashes rather than raw files | none in the report; only an upload checksum (fact 96) | NEW |
| Who or what reviewed exceptions | none | NEW |
| Family's own comments and completeness answers | per-employer comment, `has_other_jobs` (fact 36, 37, 61) | Emmy |
| Signed JSON record | HMAC on the HTTP request only (fact 71) | NEW (see implications) |
| Manifest (artifact name, type, size, pages) | CSV manifest (fact 67) | Emmy |

---

## DELIVERABLE 3. Redaction and retention approach (Emmy)

| Object | Trigger | Delay | Action | Source |
| :-- | :-- | :-- | :-- | :-- |
| Unused invitation (+ applicant if nothing else live) | invitation `expires_at` | 7 days | overwrite email; redact applicant fields | fact 84, 88, 90 |
| Incomplete flow with invitation | invitation `expires_at` | 7 days | redact flow, invitation, applicant, each payroll account | fact 88 |
| Incomplete flow without invitation | flow `updated_at` | 7 days | same | fact 88 |
| Completed and delivered flow | `transmitted_at` | 7 days | same | fact 89 |
| Completed flow that was never delivered | none | never (no scheduled rule) | waits for operator fallback, which stamps `transmitted_at` | fact 89, 76 |
| Rail account (Argyle) | on payroll-account redaction | immediate | delete at vendor by API; treat "already gone" as done; a failure is alerted, not retried by the schedule | fact 91 |
| Rail account (Pinwheel) | on payroll-account redaction | immediate | overwrite the applicant comment only; no vendor deletion | fact 91 |
| Persisted income summaries on activity flows (+ their payroll accounts) | activity flow `updated_at` | 7 days | redact summaries and payroll accounts | `emmy/app/app/services/data_retention_service.rb:10-11`, `:141-161` |
| Delivered uploaded documents | `transmitted_at` | 7 days | purge blobs; stamp `documents_deleted_at` only if all purged (processed-bucket copy: UNVERIFIED, fact 92) | fact 92 |
| Unattached uploads | blob `created_at` | 24 hours | destroy | fact 93 |
| Draft records | `created_at` | 24 hours | destroy | fact 93 |
| Finished job records | hourly | n/a | clear | fact 93 |
| One named person | operator command | immediate | redact everything for that case number | fact 94 |
| All case numbers for one agency | operator command | immediate | overwrite `case_number` on every applicant of that agency | `emmy/app/app/services/data_retention_service.rb:197-203` |

Mechanics: overwrite-in-place with typed sentinels and a `redacted_at` stamp (fact 86); one daily
scheduled run (fact 85); failure is logged, alerted, and tracked as an event, and the run continues
(fact 81, 92). What remains is a skeleton with the confirmation code and timestamps, but (CORRECTED)
it is not guaranteed to be non-identifying: device id, rail user id, the invitation token, and any
applicant attribute configured without a `redaction_type` (for example `case_number` for two of the
agencies in this commit) are left in place (fact 87).

Why Emmy can be this aggressive: the income flow stores no payroll data at all (fact 11) and the state
agency becomes the system of record once the report is delivered. The retention period an SGO needs
for audit is NOT IN SOURCES (Emmy).

---

## DELIVERABLE 4. What to reuse, what not to copy

### 4a. Product-agnostic design ideas to reuse

1. **Two entry modes behind one flow:** a pre-bound tokenized link created by API, and a tenant-wide generic link where the person self-identifies. (fact 13, 21)
2. **API key decides the tenant;** never accept a tenant id from the payload. (fact 14, 15)
3. **Opaque tokens, normalized on input,** with unknown, expired, and no-cookie as three distinct, friendly outcomes. (fact 18, 19, 20)
4. **Early expiry endpoint that is idempotent** and returns 404 for other tenants. (fact 18)
5. **Navigation as one lookup table,** with guards on each step that redirect to a recovery page instead of erroring. (fact 30, 38, 49)
6. **Two consent moments:** permission to collect and share at the start, attestation of truth and authorization to send at the end. (fact 31, 32)
7. **"Preview and approve everything that is shared"** before anything leaves, with a per-source comment box. (fact 36)
8. **Explicit completeness questions** with a mandatory answer, recorded and printed. (fact 37)
9. **Human-friendly confirmation code** used as the join key in every artifact, filename, and header. (fact 35, 68, 71) (CORRECTED: Emmy's code intends to remove look-alike characters but does not; if we want that property we build and test it ourselves, fact 35.)
10. **Random per-flow UUID as the rail-side user id.** (fact 40)
11. **Webhook rows as the sync source of truth;** per-job status of unsupported, in_progress, succeeded, failed; "fully synced" means every job reported. (fact 9, 44, 45)
12. **A small data-quality validator** between "the rail finished" and "we accept this data". (fact 46)
13. **Polling plus push for the waiting screen,** per-category progress indicators, a delay banner, and no idle timeout on that screen. (fact 26, 48)
14. **Resume instead of duplicate** when the person reconnects the same source. (fact 50)
15. **One template, two audiences** (family copy and reviewer copy), reviewer copy in English with key rows highlighted and a "how to use this report" box. (fact 52, 53, 59)
16. **Report layout:** who and what, report details (id, created, period, consent), then one section per source with summary then detail. (Deliverable 2a)
17. **State "nothing found" positively.** (fact 60)
18. **Label every datum with its provenance** (`self_attested` vs `validated`) and link entries to document ids. (fact 65)
19. **Versioned, add-only outbound JSON** with nullable "soft required" fields. (fact 65, 66)
20. **Manifest row** carrying consent timestamp and artifact name, type, size, page count. (fact 67)
21. **Pluggable delivery adapters** per receiving organization, with HMAC-signed HTTP, per-receiver headers, fixed retry ladder, per-part idempotency stamps, and an operator fallback. (fact 70 to 76)
22. **One event catalogue,** standard attributes, and a no-PII rule for analytics. (fact 78, 79, 80) (CORRECTED: in Emmy the catalogue is enforced only on the browser endpoint and the no-PII rule is a comment that the code does not fully follow. Reuse the idea; enforce both in code.)
23. **Log parameter filtering by name** and flow-tagged structured logs. (fact 82, 83)
24. **Declarative redaction:** each model lists redactable fields and types; one service owns the schedule; parents are redacted only when no live child remains; vendor-side deletion is part of redaction. (fact 86, 90, 91)
25. **Orphan janitors** for unattached uploads and drafts. (fact 93)
26. **Direct-to-bucket uploads with a quarantine bucket,** exact-size presign, 15-minute expiry, type and size allow-list, specific error copy, suggested-documents list. (fact 96 to 99)
27. **30-minute idle session with a 5-minute warning and an extend button;** no-store pages; completed flows are sealed. (fact 24, 25, 28)
28. **Locale in the URL, remembered, carried on the invitation;** translation gaps enumerated; per-tenant copy overrides with a default. (fact 100, 101, 102)
29. **Accessibility defaults enforced by components** (captions required) and by automated checks. (fact 103)
30. **Treat copy and screen changes as versioned, breaking changes.** (fact 105)
31. **Per-tenant iframe allow-list** with scoped cookie relaxation. (fact 106)
32. **Environment-flag kill switches and a sandbox launcher.** (fact 107, 108)

### 4b. Medicaid/SNAP-specific policy and Emmy-specific choices we must NOT copy

1. **The lookback window.** 90 or 182 days of pay history, "last_complete_month", "last_12_complete_months", and the guidance that "you only need to review income from the last 30 days for eligibility purposes". (`emmy/app/lib/client_agency_config.rb:16`; `emmy/app/app/models/flow.rb:6`; `emmy/app/config/locales/en.yml:1187`.) Our engine works on prior-year household income (spec frame_1.txt:229).
2. **Individual-level reporting.** Emmy verifies one person's jobs; the agency assembles the household. The success page even says "Share this link to anyone in your household who needs to report their income." (`emmy/app/config/locales/en.yml:1229`.) Our unit is the household (spec frame_1.txt:179, :229).
3. **"Report the rest directly to the agency."** In Emmy, income the tool cannot see is the applicant's job to send elsewhere (`emmy/app/config/locales/en.yml:1126`). Keep the question; in our product a "yes" must route to upload or needs_review, never to a silent pass.
4. **No decision.** Emmy never says eligible or ineligible (fact 69). Do not copy the absence of a decision section, threshold, or reviewer.
5. **Work-requirement content.** Hours worked as a headline metric, 80-hour community-engagement rule, gig mileage expense at the federal mileage rate, education enrollment, "HR1" naming. (`emmy/app/config/locales/en.yml:528`, `:1307`; `emmy/app/app/controllers/activities/submit_controller.rb:30-32`.)
6. **Agency case identifiers and SNAP fields.** `case_number`, `client_id_number` (CIN), `beacon_id` (WELID), `doc_id`, `individual_id`, `snap_application_date`. (fact 10; `emmy/app/config/locales/en.yml:1180-1193`.)
7. **SSN in the report,** even masked (fact 56, 57). Our spec asks for hashes and identifiers "rather than unnecessary raw files" (spec frame_1.txt:237).
8. **The 7-day delete-after-delivery schedule** (fact 84, 89). It assumes the receiver is the system of record.
9. **Promises that are true for Emmy and may be false for us:** "it will never be shared externally" (`en.yml:1073`), "Your login credentials and payment information are securely transmitted and not stored by us." (`en.yml:1077`), "We only use your login information to check your payroll details once." (`en.yml:1373`). Only state what our system actually does.
10. **Benefits-program legal wording:** "authorized %{agency_acronym} personnel" and "any false or omitted information may have legal consequences" (`en.yml:1166`), "to help determine your benefits" (`en.yml:1073`), "caseworker" (`en.yml:1164`). Counsel must write ours (spec frame_1.txt:197).
11. **Government identity.** The ".gov" banner ("An official website of the United States government", `en.yml:907-914`), CMS logos, "Emmy", "Report My Income". CC0 does not cover marks or endorsement (fact 3).
12. **The 10-character, reusable, long-lived link token as an authentication factor** (fact 16, 17). Our spec calls for a single-use, short-lived magic link (spec frame_1.txt:171).
13. **A new flow on every link click and total loss of progress on timeout** (fact 19, 27). Our spec wants fallback "without starting over" (spec frame_1.txt:175).
14. **Unpersisted first consent, no consent version** (fact 31, 33).
15. **Analytics as the only event trail** (fact 77). Our spec asks for audit logs (spec frame_1.txt:271).
16. **Same secret for inbound bearer auth and outbound signing** (fact 15, 71).
17. **Live re-fetch as the only copy of the evidence, and a PDF that is never stored** (fact 11).
18. **Eastern-time expiry and pilot-specific values** (14, 30, 75 days; `pilot_ended`; per-agency concurrency keys). (fact 17; `emmy/app/app/jobs/case_worker_transmitter_job.rb:16-25`.)

Added by the fact-check (Emmy implementation choices that the original listed as reusable or did not flag):

19. **Sending a record whose subject was already redacted.** Emmy reports the condition and delivers anyway (fact 95).
20. **Answering a webhook before checking its signature.** Emmy returns 200 for an unknown user before the signature check runs (fact 41).
21. **Counting a 3xx response as a successful delivery** (fact 74).
22. **A confirmation-code generator whose look-alike filter does nothing** (fact 35).
23. **Redaction that leaves identifiers behind and a state with no retention rule:** unredacted case numbers, device and rail ids, surviving link tokens (fact 87); submitted-but-undelivered flows never redacted on schedule (fact 89); no vendor-side deletion for one of the two rails (fact 91).
24. **A stored upload checksum that is never compared with the uploaded bytes** (fact 96), and an attestation timestamp that is overwritten on resubmit (fact 110).
25. **No field-level encryption of personal data and no request rate limiting in the application** (fact 112, 113). These may be acceptable inside CMS's environment; they are not defaults for us.
26. **A "no PII in analytics" rule that lives only in a comment,** while IP address, ZIP code and an email address are sent (fact 79).

---

## DELIVERABLE 5. Plain-language consent and agreement wording patterns (CC0, short quotes)

All from `emmy/app/config/locales/en.yml` unless noted. `%{...}` are Emmy's placeholders.

**Pattern 1. Say what will happen and how long it takes, before asking for anything.**
- "Let's verify your income" (`:1076`)
- "We’ll send your payment records from your employer(s) to %{agency_acronym} to verify your income. <strong>Most people complete this process in about 5 minutes.</strong> Just follow these steps:" (`:1085`)
- "Search and sign into your employer or online payroll provider." / "Review your payment information." / "Submit your payment information." (`:1079`, `:1081`, `:1083`)
- "You will be able to preview and approve everything that is shared with %{agency_acronym}." (`:1082`)

**Pattern 2. The permission checkbox: one bold sentence of who gets what, one small sentence of limits.**
- "Check this box to agree to let us access payment information from your employer and share it with %{agency_full_name}." (`:1071`)
- "We will only use this information to help determine your benefits, it will never be shared externally." (`:1073`)
- Error when unticked: "You must check the agreement checkbox to proceed." (`:1068`)
- Spanish: "Marque esta casilla si nos da permiso para acceder a la información de pago de su empleador y compartirla con %{agency_full_name}." (`emmy/app/config/locales/es.yml:237`)

**Pattern 3. Answer the security worry in the person's words.**
- "Is my data secure?" / "Yes, your data is secure. We use strong encryption, like the kind banks use, to protect your information." (`:1077-1078`)
- "We won’t share or keep your login information." (`:1080`)
- Help topic title: "I don't feel comfortable entering my login credentials" / "We understand your concerns about sharing your login information." (`:1343`, `:1367`)

**Pattern 4. Make it optional and name the alternative.**
- "This is an optional tool. If you decide that you don't want to use it, you can provide income documents via the %{app_name} app, fax, mail, or in-person." (`:891`)
- "What if I can't use this tool?" (`:1090`)
- "Can I use this tool?" (`:1094`)

**Pattern 5. Review, then correct by comment.**
- "The report below shows your recent income. Please review it before sending." (`:1242`)
- "Please review your information. If something is missing or inaccurate, add a comment for %{agency_acronym}. This will be included in your income report." (`:1160`)
- "Additional comments (Optional)" (`:1131`)

**Pattern 6. The attestation ("Legal agreement"): three bullets, then one authorization sentence.**
- Heading: "Legal agreement" (`:1167`)
- "Check this box to confirm:" / "The information provided by you is true and complete to the best of your knowledge." / "You agree to inform the %{agency_full_name} of any income not reflected in this report or any discrepancies found in the information gathered with this tool." / "You understand that providing accurate and complete information is your responsibility, and any false or omitted information may have legal consequences." / "By sending this report, you authorize its use for income verification by authorized %{agency_acronym} personnel." (`:1166`)
- Lead-in: "Your income report will be sent to %{agency_acronym}." / "You must check the legal agreement box to share your report." (`:1217-1218`)
- Button names the action and the recipient: "Share my report with %{agency_acronym}" (`:1215`)
- Error: "Please check the box to continue" (`:1220`)
- Spanish heading: "Acuerdo Legal" (`emmy/app/config/locales/es.yml:333`); full Spanish attestation at `es.yml:332`.

**Pattern 7. Confirm, give a receipt, say what is next.**
- "Your income report was successfully sent to %{agency_acronym}." (`:1227`)
- "<strong>Your confirmation code</strong>: %{confirmation_code}" (`:1223`)
- "Download my report" (`:1226`) / "We recommend saving your report for your records." (`:717`)
- "%{agency_name} will review your information and contact you if needed." (`:712`)

**Pattern 8. Say who decides.**
- "Your state will determine eligibility based on the information you submit." (`:489`)

**Pattern 9. The record itself restates consent.**
- Family copy: "We have collected your income information with your consent and sent it to %{agency_acronym}." (`:1200`)
- Reviewer copy: "The following income information was retrieved with the client's consent and has been submitted by them to their benefits agency. The client is also able to download a client-facing copy of this report." (`:1185`)
- Row label: "Agreement Consent Timestamp" (`:1179`)

**Pattern 10. Time limits and expiry, stated as safety.**
- "Do you need more time?" / "It looks like you're inactive. For your security, we will sign you out soon unless you choose to extend your session." / "Yes, extend my session" / "End session" (`:1519-1522`)
- Activity-flow timeout page: "Sessions end after 30 minutes of inactivity. This helps keep your information safe. Any information not submitted was not saved." (`:1488`)
- Income-flow timeout page: "Sessions end after 30 minutes of being away from the page. This helps keep your information safe." (`:1524`) (ADDED: the original presented the `:1488` sentence without saying it is the activity-flow page.)
- "Your invitation to verify income has expired" (`:1104`) / "Your verification link is no longer valid" (`:509`)
- Invitation email: "This process is unique to you. Please don't share this invitation with anyone else. <strong>You have until %{deadline}, to complete your verification.</strong>" (`:889`; the source sentence continues "Otherwise, you can request a new invitation." This and the `:891` quote in pattern 4 are SNAP-pilot email copy for a mailer path no API caller uses in this commit, fact 13.)

**Pattern 11. Failure copy that gives options.**
- "We couldn't access your employer information" / "We were unable to connect to your employer's system due to an error. To continue, you can:" (`:1262`, `:1266`)
- "The site is not available right now. Any information you entered will not be saved." (`:1478`)

---

## ENGINEERING IMPLICATIONS

These are requirements for our build derived from the facts above and from the spec. Items marked
(beyond Emmy) are places where Emmy is deliberately not enough.

### Piece 2: flow states

1. **Give the verification an explicit status column and an append-only transition log** (beyond Emmy, fact 5). Proposed intake states, modelled on Deliverable 1 and the spec's API statuses (spec frame_1.txt:245):
   `created → link_opened → consent_given → household_entered → method_chosen{upload|auto_submit} → collecting → review → attested → deciding → decided{eligible|ineligible|needs_review} → delivered`, with side states `link_expired`, `abandoned`, `expired` (result past its validity), `redacted`.
   Sub-states for auto-submit, copied from Emmy: per source `unknown → in_progress → succeeded | failed`; per job `unsupported | in_progress | succeeded | failed` (fact 8, 44).
2. **`sync failed` must transition back to `method_chosen` with the upload path pre-selected, keeping consent and household data** (spec frame_1.txt:175). Emmy's failure page is the model for the options (fact 38); Emmy's restart-from-zero is not (fact 19, 27).
3. **Persist both consents** (beyond Emmy, fact 31 to 33). For each: `granted_at` (UTC), `copy_version`, hash of the exact rendered text, locale shown, verification id, household id, the adult who consented, and the request's IP and user agent if counsel allows. Gate every later step server-side on consent #1. Surface `consent.version` and `consent.granted_at` in the API (spec frame_1.txt:255).
4. **Keep consent copy in versioned locale files with per-SGO override plus default** (fact 102) and bump `copy_version` on any wording change (fact 105).
5. **Magic link is not Emmy's invitation token.** Use a long, single-use, short-lived token for sign-in (spec frame_1.txt:171). Emmy patterns to keep: normalize pasted tokens, distinct pages for invalid, expired, and no-session (fact 19, 20), and an API to expire a verification link early (fact 18).
6. **Session:** 30-minute idle with a 5-minute warning modal and an extend action; no idle timeout on the waiting screen; `Cache-Control: no-store` on all intake pages; a decided verification is sealed and redirects to its result page (fact 24 to 28). Unlike Emmy, a timed-out family signs back in by magic link and resumes the same verification.
7. **Completeness step is mandatory:** "Is there other household income we did not see?" with a required answer; "yes" routes to upload or `needs_review` (fact 37; Deliverable 4b item 3).
8. **Review-before-send screen** with one section per source, a comment box per source, and edit links (fact 36).
9. **Auto-submit rail integration:** random UUID per verification as the rail user id; server-issued link token (lifetime is the rail's, NOT IN SOURCES); persist every webhook as a row; verify signatures on raw bytes with a constant-time compare, and do it before any lookup or response (beyond Emmy, fact 41); return 401 for bad signatures and, only after a valid signature, 200 for unknown or unhandled events; poll every 2 seconds plus push; show a delay banner at 5 minutes; resume rather than duplicate a source; check that every account id belongs to the current verification (fact 40 to 50).
10. **Data-quality gate** between "rail done" and "usable": name present, payer present, at least one dated positive amount, else `needs_review` (fact 46). Our gate must also test prior-year coverage, which Emmy's does not.
11. **Upload path:** presigned direct upload into a quarantine bucket, exact-size policy, 15-minute expiry, type and size allow-list, read only from the processed bucket, client checksum, hourly cleanup of unattached uploads, specific error strings, suggested-documents list per method (fact 93, 96 to 99).
12. **Embed for camps:** per-partner origin allow-list driving CSP `frame-ancestors`; `SameSite=None; Secure` cookies only for embed sessions (fact 106).
13. **Languages:** English and Spanish from day one, locale in the URL and on the verification, English fallback, an enumerated list of untranslated keys in CI; the SGO-facing pack in English, the family copy in the family's language (fact 52, 100, 101).
14. **Accessibility:** `lang`, skip link, required table captions, labelled dialogs, focus on error summaries, automated axe checks in tests (fact 103).
15. **Ops:** environment-flag banners for rail outage and maintenance; a sandbox launcher that creates synthetic households only (fact 107, 108; spec frame_1.txt:276).

### Piece 3: evidence pack and API

16. **Freeze a snapshot at decision time** (beyond Emmy, fact 11). Store one canonical JSON record and the rendered PDF; never rebuild evidence by re-querying a rail.
17. **Evidence JSON shape,** combining Emmy's fields with the spec's (spec frame_1.txt:237, :243-255): `schema_version`; `verification_id` (confirmation code); `status`; `method`; `decided_at`; `household {size, members}`; `area`; `threshold_usd`; `threshold_source`; threshold effective date; provisional flag; `income_year` or `award_letter_date`; `sources[]` each with `data_source` (document, rail, self_attested), document or rail identifier, extracted fields, and `sha256` of the underlying file; `completeness_answers`; `family_comments`; `consent {version, granted_at, text_sha256, locale}` for both moments; `review {reviewer, reviewed_at, reason}` when an exception was reviewed; `expires_at`; `artifacts[] {name, type, bytes, pages, sha256}` (manifest, fact 67).
18. **Evidence PDF layout,** following Deliverable 2a: header and footer with verification id on every page; provenance and consent sentence; "How to read this record" box; Decision box (status, method, household size, area, threshold, source, effective date, provisional label); Record details (id, created, period covered, consent versions and timestamps); one section per source with summary then detail and key rows highlighted; explicit "nothing found" statements; family comments; file hashes; reviewer line. Money as integer cents formatted at render (fact 62).
19. **"Signed JSON" needs more than Emmy's transport HMAC** (beyond Emmy, fact 71). Emmy signs the HTTP request with a shared secret, which proves delivery origin to the receiver only. For an artifact an auditor can check later, sign the canonical JSON bytes with a platform private key and publish the public key, and include the PDF's SHA-256 inside the signed JSON. Algorithm and key custody: NOT IN SOURCES; decide with the security memo (spec frame_1.txt:268, :276).
20. **Webhooks to SGOs and camps:** HMAC-SHA512 of `"<timestamp>:<raw body>"` in timestamp and signature headers, plus a verification-id header; sign exact bytes; only 2xx is success (Emmy's JSON transmitter also accepts 3xx; do not copy, fact 74); retries at 5 minutes, 10 minutes, 30 minutes, 1 hour, 4 hours; one in-flight delivery per verification; per-part delivered-at stamps; per-receiver custom headers; an operator view of permanently failed deliveries (fact 71 to 76). Use a dedicated signing secret per receiver, distinct from the API key (Deliverable 4b item 16). Add a timestamp-freshness rule for receivers; Emmy documents none.
21. **API tenancy:** API key selects the SGO; ignore any tenant id in the body; unknown and other-tenant ids both return 404; keys random, stored encrypted or hashed, revocable (fact 14, 15, 18).
22. **Outbound schema policy:** add-only within a major version, nullable soft-required fields, `schema_version` in every payload (fact 65, 66).
23. **Audit log is a first-party, append-only table** (beyond Emmy, fact 77): actor, action, verification id, tenant id, timestamp, before and after status. Reuse Emmy's event vocabulary for names (fact 80). Analytics, if any, gets only non-PII fields (fact 79). Filter sensitive parameter names from logs (fact 82).
24. **Retention jobs:** one scheduled service, declarative redactable fields per model, overwrite-and-stamp, parents redacted only when no live child remains, rail account deleted at the vendor during redaction, raw uploads purged on their own clock with a "deleted at" stamp only when every file is gone, failures alerted (fact 85 to 92). Keep a skeleton (id, status, timestamps, hashes) after redaction, and make it actually non-identifying (beyond Emmy, fact 87): every personal field needs a declared redaction type, with a test that fails when a new column has none. Give every state a retention rule, including "decided but never delivered" (beyond Emmy, fact 89). Delete at every rail we integrate, not just one (beyond Emmy, fact 91), and retry a failed vendor deletion on the next run. Purge every bucket that holds a copy of an upload (fact 92).
25. **Never deliver a redacted record:** alert and stop (beyond Emmy: Emmy reports the error and then delivers anyway, fact 95).
26. **Submit must be idempotent:** generate the id once, enqueue delivery once, in one transaction. Emmy's income submit guards the code but not the enqueue line, and relies on a before-action redirect plus a one-at-a-time job limit (fact 32); its activity submit wraps code, timestamp and enqueue in one transaction (fact 110). Follow the second, and never overwrite the attestation timestamp.
26a. **(ADDED) Confirmation or verification id:** if we want a human-readable id without look-alike characters, generate it from an explicit alphabet and unit-test that O, I, S, B (and 0, 1, 5, 8 if both are excluded) cannot appear. Emmy's generator does not achieve this (fact 35).
26b. **(ADDED) File hashes in the evidence pack** must be computed server-side from the stored bytes. A client-supplied checksum that is only format-checked, as in Emmy (fact 96), is not evidence.
26c. **(ADDED) Rate-limit link-token and magic-link endpoints** and decide field-level encryption for family PII in the security memo; Emmy shows neither (fact 112, 113; spec frame_1.txt:276).

### Copy

27. Reuse the eleven wording patterns in Deliverable 5 as structure. Replace every agency, benefits, caseworker, ".gov", and "never shared" phrase (Deliverable 4b items 9 to 11). Final consent and attestation text is counsel's (spec frame_1.txt:197).
28. Do not use the names "Emmy" or "Report My Income", CMS marks, or wording that suggests government affiliation or CMS endorsement (fact 3).

---

## OPEN QUESTIONS / AMBIGUITIES

1. **How long must an SGO keep verification evidence, and may raw documents be deleted once hashed?** NOT IN SOURCES (Emmy). Emmy's 7 days reflects its conduit role (fact 84, 89). This has to come from the section 25F research and counsel, and it sets every number in implication 24.
2. **Why 7 days?** Emmy's rationale is NOT IN SOURCES. Its decision records are private: its ADRs "are not currently accessible to the public." (`emmy/README.md:46`).
3. **Consent withdrawal and "delete my data" requests.** Emmy has no applicant-facing revoke or delete path; only an operator command (fact 94). A search of Emmy's locale file, views, and controllers for revoke, withdraw, opt out, privacy policy, or terms of service finds nothing. Our required behaviour is NOT IN SOURCES.
4. **FCRA.** The Emmy repo does not mention FCRA, consumer reports, or permissible purpose anywhere. It gives no guidance on our FCRA posture (spec frame_1.txt:286).
5. **Official Emmy income JSON schema.** The public doc is a placeholder: "Contact the Emmy Team to request documentation about the Income Report API." (`emmy/docs/api/receiving-data/income-reports.md:1`). Facts 63 and 64 are read from code, not from a published contract.
6. **Malware scanning of uploads.** The unscanned-to-processed bucket split is visible (fact 96), and a comment refers to an "upload-processing Lambda ceiling in emmy-infra" (`emmy/app/lib/client_agency_config.rb:30`), but the scanner itself lives in another repository. Tool, verdict handling, and what the applicant sees on a rejected file are NOT IN SOURCES.
7. **Signature algorithm and key management for our signed JSON.** Emmy offers only shared-secret HMAC (fact 71). NOT IN SOURCES.
8. **Replay protection.** Emmy sends a timestamp but its receiver guidance sets no freshness window (`emmy/docs/api/receiving-data/webhook-signatures.md:25-28`). Our tolerance value is NOT IN SOURCES.
9. **Which consent is the legally operative one?** Emmy persists only the final attestation (fact 32) and reports it as both "date created" and "consent timestamp" (fact 55). Whether our record should treat the opening permission, the closing attestation, or both as "the consent" in `consent.granted_at` is a counsel question.
10. **One consenting adult or every adult?** Emmy has each household member complete their own flow under their own invitation (fact 12, 23). Our spec wants "more than one adult on the household, with a clear owner for consent" (spec frame_1.txt:171). Whether a rail connection for a second adult's payroll needs that adult's own consent screen is not settled by Emmy.
11. **Passport reuse.** Emmy has no concept of reusing a completed result with a second recipient under a fresh consent (spec frame_1.txt:187, :241). No reference design in Emmy.
12. **Result validity period (`expires_at`).** Emmy has invitation expiry (fact 17) but no expiry on a delivered report. NOT IN SOURCES.
13. **Rail choice.** Emmy integrates Argyle and Pinwheel only; event names and sync semantics in facts 42 and 43 are specific to those two. Truv or Plaid mappings are NOT IN SOURCES.
14. **Storing rail data.** Emmy's income flow avoids storing payroll data (fact 11); its newer activity flow does persist monthly and employment summaries (`emmy/app/db/schema.rb:46-65`, `:84-100`). Our snapshot requirement (implication 16) means we store more than Emmy's income flow does; the minimum field set to keep is a privacy and counsel decision.
15. **Spanish coverage of the reviewer-facing pack.** Emmy leaves caseworker PDF labels untranslated on purpose (fact 101). Whether any SGO needs a Spanish evidence pack is NOT IN SOURCES.

Added by the fact-check:

16. **Does Emmy ever delete the scanned ("processed") copy of an uploaded document?** The retention job purges the attachment registered on the unscanned service; no code in this repository deletes from the processed bucket (fact 92). NOT IN SOURCES (likely `emmy-infra`). Do not assume Emmy demonstrates end-to-end deletion of uploads.
17. **Does production Emmy sit behind a WAF or rate limiter?** The application has none and the infra template lists the WAF as a TODO (fact 113). Deployed state is NOT IN SOURCES.
18. **Is Emmy's behaviour of delivering a record after the applicant was redacted intentional?** The code reports the condition and continues (fact 95). No comment or doc explains the choice. NOT IN SOURCES.
19. **Is the ineffective look-alike filter in the confirmation code a known bug?** The code and its effect are verified (fact 35); Emmy's intent and any fix are NOT IN SOURCES.
20. **Nothing in this file, before or after the fact-check, is a finding about IRC section 25F, REG-117199-25 or T.D. 10057.** Retention periods, what an SGO must keep, and what a consent must say for section 25F purposes have to come from the section 25F research files and counsel. Every Emmy number here (7 days, 30 minutes, 14/30/75 days, 90/182 days, 40 MB, the retry ladder) is an Emmy configuration value, not a legal requirement and not a recommendation for our product.

---

## VERIFICATION LOG

Adversarial fact-check performed 2026-11-18 against the clone at
`/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/emmy`
(HEAD `be62e541e08ab81b111219801c8afa5733d570e4`, confirmed with `git log -1`; `app/version.txt` = 0.16.0).

**Method.** Every cited file and line range for facts 1 to 109 was opened and read with line numbers.
Every quoted string was compared with the source text. All 60-odd `en.yml` line citations in the facts
and in Deliverables 4b and 5 were read at the cited lines, as were the three `es.yml` citations and all
`spec frame_1.txt` line citations. Negative claims (no revoke path, no FCRA mention, no hashing in the
report path, no stored PDF) were re-run as searches. One code claim was executed: the confirmation-code
expression was run in Ruby to observe its real output.

**Confidence tags.** All Emmy facts remain `[secondary/web]`, which is correct: they describe a
third-party open-source codebase. No fact in this file is tagged or presented as statute, temporary
regulation or proposed regulation, and none makes a section 25F claim (Open Question 20 states this
explicitly). The local section 25F source files were not needed for this topic and were not relied on.

**Confirmed without change** (quote verbatim at or within the cited lines; rule follows from the quote):
facts 1 to 7, 9 to 12, 14 to 26, 28 to 31, 33, 34, 36 to 39, 42 to 44, 47 to 53, 56, 57, 59 to 70, 72,
73, 75 to 78, 81 to 86, 88, 90, 93, 94, 97 to 104, 106 to 109 (facts 13, 32, 45, 54, 55, 58, 71, 89,
96 and 105 were also confirmed as written and only had nuance lines added, listed below); the license
(CC0 1.0 Universal, quoted
from `LICENSE`, `LICENSE.md`, `code.json`, `README.md`); the state diagram's transitions, routes and
copy strings; Deliverable 2; the spec line citations.

**Corrected (what was wrong, what it says now).**

1. Fact 35 and Deliverable 4a item 9: said the confirmation code swaps look-alike letters O, I, S, B.
   It does not: `to_s(36)` is lower-case, `tr("OISB", ...)` matches upper-case only, and `upcase` runs
   afterwards. Ruby run produced `SANDBOXOIS0042`. Now states the filter is a no-op and must not be
   cited as a working pattern.
2. Fact 95 and implication 25: said a redacted applicant "raises an alert rather than silently sending
   REDACTED". The code calls `NewRelic::Agent.notice_error` and then delivers and stamps
   `transmitted_at`. Now states Emmy reports and sends anyway; "stop" is our requirement.
3. Fact 80 and Deliverable 4a item 22: said event names are a "closed, typed catalogue" and cited
   `track_event.rb:3-81`. The file is 163 lines; `ApplicantAccessedSuccessPage` and
   `DataRedactionFailure` are string literals outside the catalogue. Now says the catalogue is enforced
   only on the browser endpoint; citation fixed to `:3-163`.
4. Fact 79: "hard rule" downgraded to "stated rule (a code comment)"; listed the identifying values the
   code still sends (IP, user agent, ZIP code, rail account id, service-account email, confirmation
   code), each with file and line.
5. Fact 74 and implication 20: "success is any 2xx" was true of the docs and the PDF/document
   transmitters only; the income JSON transmitter also treats 3xx as delivered
   (`json_transmitter.rb:26-29`). Now says so and tells us to accept 2xx only.
6. Fact 87 and Deliverable 3 "mechanics": said what survives redaction is a "non-identifying
   skeleton". Device id, rail user id, the link token and applicant attributes without a
   `redaction_type` (for example `case_number` for `nh_dhhs` and `sandbox`) survive. Now says so.
7. Fact 91: vendor-side deletion presented as general; it is Argyle-only. Pinwheel accounts are not
   deleted at the vendor. Added that a failed Argyle deletion is alerted but not retried by the schedule.
8. Fact 46: validator described as "at least one identity with a full name"; the code requires every
   identity to have a full name and every employment an employer name, and the paystub conditions need
   not hold on the same paystub. Reworded; added the "unemployed" bypass.
9. Fact 27 and Deliverable 5 pattern 10: the sentence "Any information not submitted was not saved" is
   from the activity-flow timeout page (`en.yml:1488`), not the income-flow page (`en.yml:1524`). Both
   are now quoted and labelled.
10. Fact 40 and implication 9: "short-lived" token removed; Emmy's code states no token lifetime.
11. Fact 8: quote completed (it had dropped two of the four enum lines).
12. Deliverable 4b item 10: "to help determine your benefits" was cited to `en.yml:1166`; it is at
    `:1073`. "caseworker" given a citation (`:1164`).

**Added (omissions).** Nuance lines on facts 13 (dormant email path), 32 (how repeat submits are
actually stopped), 41 (Pinwheel algorithm; signature checked after the flow lookup), 45 (minimum jobs
per rail), 54 (row only for agencies with a ReportFields class), 55 (unformatted consent timestamp),
58 (W-2 only; gig branch differs), 71 (which posts carry the confirmation-code header), 89 (a
submitted-but-undelivered flow has no scheduled redaction rule), 96 (checksum never compared with
bytes), 105 (pre-1.0 rule). New facts 110 (activity-flow attestation record), 111 (document delivery
headers), 112 (encryption scope), 113 (no rate limiting, WAF TODO), 114 (operator job dashboard), 115
(V2 invitation API), 116 (activity delivery job). New rows in Deliverable 3. New items 19 to 26 in
Deliverable 4b. New implications 26a to 26c. New Open Questions 16 to 20.

**Marked UNVERIFIED.**

- Fact 92: whether the scanned copy of an upload in the "processed" bucket is ever deleted. Not in
  this repository.
- Fact 113: whether production Emmy has a WAF or rate limit outside this repository.
- Fact 112: whether deployed environments match the Terraform that enables database encryption.

**Removed as fabricated.** None. No invented file, line, number or quote was found; the errors above
were over-readings of real code, not fabrications.

**Not re-checked.** GitHub was not re-fetched; the local clone was treated as the source (the
provenance note and `git remote -v` both name `https://github.com/DSACMS/iv-cbv-payroll`). Rendering
behaviour (what the PDF actually looks like, what the modal does in a browser) was read from templates
and scripts, not run. Spanish strings beyond the three cited lines were not reviewed.
