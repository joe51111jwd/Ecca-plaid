CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"org_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"ip" text,
	"user_agent" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" text PRIMARY KEY NOT NULL,
	"to_email" text NOT NULL,
	"from_email" text NOT NULL,
	"subject" text NOT NULL,
	"template" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text DEFAULT 'outbox' NOT NULL,
	"provider_id" text,
	"error" text,
	"related_type" text,
	"related_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objects" (
	"id" text PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"purpose" text NOT NULL,
	"sha256" text NOT NULL,
	"size" bigint NOT NULL,
	"content_type" text NOT NULL,
	"filename" text,
	"wrapped_key" text NOT NULL,
	"org_id" text,
	"household_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"phone" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"event_id" text NOT NULL,
	"org_id" text NOT NULL,
	"event_type" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"response_status" integer,
	"response_excerpt" text,
	"error" text,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"secret_enc" text NOT NULL,
	"event_types" jsonb DEFAULT '["*"]'::jsonb NOT NULL,
	"format" text DEFAULT 'native' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_links" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"redirect_to" text,
	"context" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sgo_list_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"state" text NOT NULL,
	"name" text NOT NULL,
	"ein" text,
	"match_key" text NOT NULL,
	"status" text DEFAULT 'listed' NOT NULL,
	"listed_from" text,
	"removed_on" text,
	"source_url" text,
	"source_retrieved_at" timestamp with time zone,
	"raw" jsonb,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sgo_profiles" (
	"org_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"legal_name" text,
	"ein" text,
	"description" text,
	"website" text,
	"city" text,
	"state" text DEFAULT 'TX' NOT NULL,
	"support_email" text,
	"logo_url" text,
	"list_entry_id" text,
	"irs_portal_registered" boolean DEFAULT false NOT NULL,
	"irs_portal_registered_at" timestamp with time zone,
	"accepts_donations" boolean DEFAULT true NOT NULL,
	"accepts_handoffs" boolean DEFAULT false NOT NULL,
	"dashboard_only" boolean DEFAULT false NOT NULL,
	"income_cap_pct" integer DEFAULT 300 NOT NULL,
	"review_band_bps" integer DEFAULT 500 NOT NULL,
	"raw_retention_days" integer DEFAULT 30 NOT NULL,
	"payments_account_id" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "awards" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"verification_id" text NOT NULL,
	"handoff_id" text,
	"student_member_id" text,
	"amount_cents" bigint NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"payment_method" text DEFAULT 'direct_to_vendor' NOT NULL,
	"notes" text,
	"decided_by" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"household_id" text,
	"verification_id" text,
	"recipient_org_id" text,
	"copy_version" text NOT NULL,
	"copy_sha256" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"verification_id" text NOT NULL,
	"household_id" text NOT NULL,
	"declared_kind" text NOT NULL,
	"detected_kind" text,
	"member_id" text,
	"object_id" text NOT NULL,
	"sha256" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"extraction_enc" text,
	"extracted_by" text,
	"review_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"extracted_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" text,
	"source_document_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"kind" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"dob_enc" text,
	"relationship" text,
	"user_id" text,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"zip" text,
	"county_fips" text,
	"county_name" text,
	"county_resolution" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "income_items" (
	"id" text PRIMARY KEY NOT NULL,
	"verification_id" text NOT NULL,
	"member_id" text,
	"source" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"income_year" integer NOT NULL,
	"annual_amount_cents" bigint NOT NULL,
	"counted" boolean DEFAULT true NOT NULL,
	"basis" text,
	"document_id" text,
	"rail_connection_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rail_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"verification_id" text NOT NULL,
	"member_id" text,
	"provider" text NOT NULL,
	"kind" text DEFAULT 'payroll' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"external_id" text,
	"access_token_enc" text,
	"report_enc" text,
	"report_sha256" text,
	"consent_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"verification_id" text NOT NULL,
	"org_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_to" text,
	"assigned_at" timestamp with time zone,
	"more_info_requested_at" timestamp with time zone,
	"resolution" text,
	"resolution_notes" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_certifications" (
	"id" text PRIMARY KEY NOT NULL,
	"verification_id" text NOT NULL,
	"household_id" text NOT NULL,
	"kind" text NOT NULL,
	"member_id" text,
	"income_year" integer NOT NULL,
	"signed_by_user_id" text NOT NULL,
	"signed_by_member_id" text NOT NULL,
	"copy_version" text NOT NULL,
	"copy_sha256" text NOT NULL,
	"locale" text NOT NULL,
	"vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"source_certification_id" text
);
--> statement-breakpoint
CREATE TABLE "verification_events" (
	"id" text PRIMARY KEY NOT NULL,
	"verification_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stage" text DEFAULT 'created' NOT NULL,
	"method" text,
	"path_preference" text,
	"external_ref" text,
	"applicant_email" text,
	"applicant_name" text,
	"student_first_name" text,
	"student_last_name" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"return_url" text,
	"created_by_type" text DEFAULT 'user' NOT NULL,
	"created_by_id" text,
	"family_token_hash" text NOT NULL,
	"family_token_expires_at" timestamp with time zone NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"started_at" timestamp with time zone,
	"started_by_user_id" text,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"household_id" text,
	"consent_id" text,
	"consent_version" text,
	"consent_granted_at" timestamp with time zone,
	"household_completed_at" timestamp with time zone,
	"handoff_id" text,
	"passport_source_id" text,
	"passport_source_decided_at" timestamp with time zone,
	"evidence_copied_from_id" text,
	"passport_source_record_sha256" text,
	"family_request" jsonb,
	"student_member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custody" jsonb,
	"application_date" text,
	"income_year" integer,
	"household_size" integer,
	"county_fips" text,
	"county_name" text,
	"hud_area_code" text,
	"area_name" text,
	"median_income_cents" bigint,
	"threshold_cents" bigint,
	"threshold_source" text,
	"threshold_table_version" text,
	"threshold_effective_date" text,
	"income_cap_pct" integer,
	"household_income_cents" bigint,
	"award_program" text,
	"award_letter_date" text,
	"provisional" boolean DEFAULT true NOT NULL,
	"decision" jsonb,
	"decision_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"expires_at" timestamp with time zone,
	"evidence_pdf_object_id" text,
	"evidence_json_object_id" text,
	"submitted_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acknowledgment_notices" (
	"org_id" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"tax_year" integer NOT NULL,
	"kind" text NOT NULL,
	"level" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"email_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "acknowledgment_notices_org_id_mode_tax_year_kind_level_pk" PRIMARY KEY("org_id","mode","tax_year","kind","level")
);
--> statement-breakpoint
CREATE TABLE "acknowledgment_refreshes" (
	"org_id" text NOT NULL,
	"donor_id" text NOT NULL,
	"tax_year" integer NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"reason" text NOT NULL,
	"last_donation_id" text,
	"requested_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "acknowledgment_refreshes_org_id_donor_id_tax_year_mode_pk" PRIMARY KEY("org_id","donor_id","tax_year","mode")
);
--> statement-breakpoint
CREATE TABLE "acknowledgments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"donor_id" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"tax_year" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"blocked_reason" text,
	"sgo_ein" text,
	"unique_donor_number" text,
	"total_designated_cents" bigint NOT NULL,
	"goods_or_services_provided" boolean DEFAULT false NOT NULL,
	"goods_or_services_value_cents" bigint DEFAULT 0 NOT NULL,
	"donation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pdf_object_id" text,
	"delivery" text DEFAULT 'email' NOT NULL,
	"issued_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"email_id" text,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"non_designated_cents" bigint DEFAULT 0 NOT NULL,
	"goods_or_services_description" text,
	"delivery_email" text,
	"delivery_consent_id" text,
	"content_sha256" text,
	"pdf_sha256" text,
	"snapshot" jsonb,
	"issued_by" text,
	"mailed_by" text,
	"superseded_at" timestamp with time zone,
	"superseded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkout_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"email" text,
	"filing_status" text,
	"form" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preview" jsonb,
	"source" text DEFAULT 'hosted' NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text,
	"order_number" integer DEFAULT 0 NOT NULL,
	"order_fingerprint" text,
	"payment_id" text,
	"placed_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"checkout_session_id" text NOT NULL,
	"payment_id" text,
	"donor_id" text NOT NULL,
	"taxpayer_role" text DEFAULT 'individual' NOT NULL,
	"filing_status" text NOT NULL,
	"order_number" integer DEFAULT 1 NOT NULL,
	"designated_amount_cents" bigint NOT NULL,
	"non_designated_amount_cents" bigint DEFAULT 0 NOT NULL,
	"designated_25f" boolean NOT NULL,
	"designated_at" timestamp with time zone NOT NULL,
	"designation_copy_version" text NOT NULL,
	"designation_copy_id" text NOT NULL,
	"designation_text" text NOT NULL,
	"designation_template_sha256" text NOT NULL,
	"designation_text_sha256" text NOT NULL,
	"no_earmark_confirmed" boolean NOT NULL,
	"individual_confirmed" boolean NOT NULL,
	"us_citizen_or_resident_confirmed" boolean DEFAULT false NOT NULL,
	"not_in_exchange_confirmed" boolean DEFAULT false NOT NULL,
	"joint_on_behalf_of_both_confirmed" boolean DEFAULT false NOT NULL,
	"attestations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state_allocation" text NOT NULL,
	"donor_time_zone" text NOT NULL,
	"expected_state_credit_cents" bigint DEFAULT 0 NOT NULL,
	"fee_structure" text DEFAULT 'none' NOT NULL,
	"platform_fee_cents" bigint DEFAULT 0 NOT NULL,
	"donor_service_fee_cents" bigint DEFAULT 0 NOT NULL,
	"goods_or_services_provided" boolean DEFAULT false NOT NULL,
	"goods_or_services_value_cents" bigint DEFAULT 0 NOT NULL,
	"goods_or_services_description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"contributed_at" timestamp with time zone,
	"tax_year" integer,
	"year_boundary_ambiguous" boolean DEFAULT false NOT NULL,
	"credit_eligible" boolean DEFAULT false NOT NULL,
	"credit_ineligible_reason" text,
	"sgo_list_status_at_gift" text,
	"sgo_list_entry_id_at_gift" text,
	"reliance_at_order" jsonb,
	"reliance_at_charge" jsonb,
	"eligibility_at_order" jsonb,
	"eligibility_at_charge" jsonb,
	"e_delivery_consent_id" text,
	"receipt_email_id" text,
	"failure_reason" text,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donor_delivery_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"donor_id" text NOT NULL,
	"org_id" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"checkout_session_id" text,
	"email" text NOT NULL,
	"copy_id" text NOT NULL,
	"copy_version" text NOT NULL,
	"template_sha256" text NOT NULL,
	"text_sha256" text NOT NULL,
	"text" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" text,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "donor_numbers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"donor_id" text NOT NULL,
	"tax_year" integer NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"number" text NOT NULL,
	"source" text NOT NULL,
	"assigned_by" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replaced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "donor_year_totals" (
	"org_id" text NOT NULL,
	"donor_id" text NOT NULL,
	"tax_year" integer NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"designated_cents" bigint DEFAULT 0 NOT NULL,
	"non_designated_cents" bigint DEFAULT 0 NOT NULL,
	"gift_count" integer DEFAULT 0 NOT NULL,
	"last_contributed_at" timestamp with time zone,
	"combined_with_spouse_cents" bigint DEFAULT 0 NOT NULL,
	"substantial_contributor" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donor_year_totals_org_id_donor_id_tax_year_mode_pk" PRIMARY KEY("org_id","donor_id","tax_year","mode")
);
--> statement-breakpoint
CREATE TABLE "donors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"suffix" text,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip" text NOT NULL,
	"spouse_donor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"payer_org_id" text,
	"kind" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" text DEFAULT 'accrued' NOT NULL,
	"donation_id" text,
	"handoff_id" text,
	"invoice_id" text,
	"description" text,
	"payment_id" text,
	"fee_structure" text,
	"fee_bps" integer,
	"base_cents" bigint,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "irs_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"tax_year" integer NOT NULL,
	"row_count" integer NOT NULL,
	"total_designated_cents" bigint NOT NULL,
	"object_id" text,
	"sha256" text,
	"generated_by" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"filename" text,
	"acknowledged_total_cents" bigint DEFAULT 0 NOT NULL,
	"consistency" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_on" text,
	"submission_reference" text,
	"submitted_by" text
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"processor" text NOT NULL,
	"processor_payment_id" text,
	"purpose" text NOT NULL,
	"checkout_session_id" text,
	"org_id" text,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text DEFAULT 'requires_payment' NOT NULL,
	"method" text,
	"failure_reason" text,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"fee_ledger_id" text,
	"handoff_id" text,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"business_org_id" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"period_start" text,
	"period_end" text,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"processor" text DEFAULT 'sandbox' NOT NULL,
	"processor_invoice_id" text,
	"hosted_url" text,
	"pdf_object_id" text,
	"due_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_profiles" (
	"org_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"vendor_type" text DEFAULT 'summer_camp' NOT NULL,
	"website" text,
	"billing_email" text,
	"payments_customer_id" text,
	"success_fee_flat_cents" bigint DEFAULT 0 NOT NULL,
	"success_fee_bps" integer DEFAULT 0 NOT NULL,
	"hold_window_hours" integer DEFAULT 72 NOT NULL,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brand_color" text,
	"logo_url" text,
	"publishable_key" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"business_org_id" text NOT NULL,
	"sgo_org_id" text,
	"mode" text DEFAULT 'test' NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"channel" text DEFAULT 'redirect' NOT NULL,
	"booking_ref" text NOT NULL,
	"booking_description" text,
	"booking_amount_cents" bigint,
	"family_email" text,
	"student_first_name" text,
	"student_last_name" text,
	"verification_id" text,
	"award_id" text,
	"return_url" text,
	"token_hash" text NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"decline_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_via" text DEFAULT 'api' NOT NULL,
	"created_by_api_key_id" text,
	"idempotency_key" text,
	"booking_amount_confirmed" boolean DEFAULT false NOT NULL,
	"sgo_chosen_by" text,
	"family_link_enc" text,
	"hold_extended_hours" integer DEFAULT 0 NOT NULL,
	"status_changed_at" timestamp with time zone,
	"canceled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partnerships" (
	"id" text PRIMARY KEY NOT NULL,
	"business_org_id" text NOT NULL,
	"sgo_org_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sgo_profiles" ADD CONSTRAINT "sgo_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sgo_profiles" ADD CONSTRAINT "sgo_profiles_list_entry_id_sgo_list_entries_id_fk" FOREIGN KEY ("list_entry_id") REFERENCES "public"."sgo_list_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_verification_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_student_member_id_household_members_id_fk" FOREIGN KEY ("student_member_id") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_recipient_org_id_organizations_id_fk" FOREIGN KEY ("recipient_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_verification_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_items" ADD CONSTRAINT "income_items_verification_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_items" ADD CONSTRAINT "income_items_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_items" ADD CONSTRAINT "income_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rail_connections" ADD CONSTRAINT "rail_connections_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rail_connections" ADD CONSTRAINT "rail_connections_verification_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rail_connections" ADD CONSTRAINT "rail_connections_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rail_connections" ADD CONSTRAINT "rail_connections_consent_id_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_verification_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_certifications" ADD CONSTRAINT "verification_certifications_verification_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_certifications" ADD CONSTRAINT "verification_certifications_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_certifications" ADD CONSTRAINT "verification_certifications_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_certifications" ADD CONSTRAINT "verification_certifications_signed_by_user_id_users_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_certifications" ADD CONSTRAINT "verification_certifications_signed_by_member_id_household_members_id_fk" FOREIGN KEY ("signed_by_member_id") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_events" ADD CONSTRAINT "verification_events_verification_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_consent_id_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_evidence_pdf_object_id_objects_id_fk" FOREIGN KEY ("evidence_pdf_object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_evidence_json_object_id_objects_id_fk" FOREIGN KEY ("evidence_json_object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgment_notices" ADD CONSTRAINT "acknowledgment_notices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgment_refreshes" ADD CONSTRAINT "acknowledgment_refreshes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgment_refreshes" ADD CONSTRAINT "acknowledgment_refreshes_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgments" ADD CONSTRAINT "acknowledgments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgments" ADD CONSTRAINT "acknowledgments_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgments" ADD CONSTRAINT "acknowledgments_pdf_object_id_objects_id_fk" FOREIGN KEY ("pdf_object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_checkout_session_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_delivery_consents" ADD CONSTRAINT "donor_delivery_consents_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_delivery_consents" ADD CONSTRAINT "donor_delivery_consents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_delivery_consents" ADD CONSTRAINT "donor_delivery_consents_checkout_session_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_numbers" ADD CONSTRAINT "donor_numbers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_numbers" ADD CONSTRAINT "donor_numbers_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_year_totals" ADD CONSTRAINT "donor_year_totals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_year_totals" ADD CONSTRAINT "donor_year_totals_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donors" ADD CONSTRAINT "donors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_payer_org_id_organizations_id_fk" FOREIGN KEY ("payer_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "irs_reports" ADD CONSTRAINT "irs_reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "irs_reports" ADD CONSTRAINT "irs_reports_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_checkout_session_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_invoice_lines" ADD CONSTRAINT "business_invoice_lines_invoice_id_business_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."business_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_invoices" ADD CONSTRAINT "business_invoices_business_org_id_organizations_id_fk" FOREIGN KEY ("business_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_invoices" ADD CONSTRAINT "business_invoices_pdf_object_id_objects_id_fk" FOREIGN KEY ("pdf_object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_business_org_id_organizations_id_fk" FOREIGN KEY ("business_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_sgo_org_id_organizations_id_fk" FOREIGN KEY ("sgo_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_business_org_id_organizations_id_fk" FOREIGN KEY ("business_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_sgo_org_id_organizations_id_fk" FOREIGN KEY ("sgo_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_org_at_idx" ON "audit_logs" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_logs" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX "emails_to_idx" ON "emails" USING btree ("to_email","created_at");--> statement-breakpoint
CREATE INDEX "events_org_idx" ON "events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_dedupe_idx" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_type_idx" ON "jobs" USING btree ("type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "objects_key_uq" ON "objects" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "objects_org_idx" ON "objects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "objects_household_idx" ON "objects" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uq" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "organizations_type_idx" ON "organizations" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_event_idx" ON "webhook_deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_org_idx" ON "webhook_endpoints" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "magic_links_token_uq" ON "magic_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "magic_links_email_idx" ON "magic_links" USING btree ("email","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sgo_list_state_idx" ON "sgo_list_entries" USING btree ("state","status");--> statement-breakpoint
CREATE INDEX "sgo_list_ein_idx" ON "sgo_list_entries" USING btree ("ein");--> statement-breakpoint
CREATE UNIQUE INDEX "sgo_list_source_state_key_uq" ON "sgo_list_entries" USING btree ("source","state","match_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sgo_profiles_ein_uq" ON "sgo_profiles" USING btree ("ein");--> statement-breakpoint
CREATE UNIQUE INDEX "sgo_profiles_list_entry_uq" ON "sgo_profiles" USING btree ("list_entry_id");--> statement-breakpoint
CREATE INDEX "awards_org_idx" ON "awards" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "awards_verification_idx" ON "awards" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "awards_handoff_idx" ON "awards" USING btree ("handoff_id");--> statement-breakpoint
CREATE INDEX "consents_household_idx" ON "consents" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "consents_verification_idx" ON "consents" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "documents_verification_idx" ON "documents" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "documents_purge_idx" ON "documents" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "documents_verification_sha_idx" ON "documents" USING btree ("verification_id","sha256");--> statement-breakpoint
CREATE INDEX "household_members_household_idx" ON "household_members" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "households_owner_idx" ON "households" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "income_items_verification_idx" ON "income_items" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "rail_connections_verification_idx" ON "rail_connections" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "review_tasks_org_idx" ON "review_tasks" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "review_tasks_verification_idx" ON "review_tasks" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "verification_certifications_ver_idx" ON "verification_certifications" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "verification_events_ver_idx" ON "verification_events" USING btree ("verification_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verifications_family_token_uq" ON "verifications" USING btree ("family_token_hash");--> statement-breakpoint
CREATE INDEX "verifications_org_idx" ON "verifications" USING btree ("org_id","mode","created_at");--> statement-breakpoint
CREATE INDEX "verifications_org_status_idx" ON "verifications" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "verifications_household_idx" ON "verifications" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "verifications_external_ref_idx" ON "verifications" USING btree ("org_id","external_ref");--> statement-breakpoint
CREATE INDEX "verifications_status_expires_idx" ON "verifications" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "verifications_status_link_idx" ON "verifications" USING btree ("status","family_token_expires_at");--> statement-breakpoint
CREATE INDEX "verifications_status_updated_idx" ON "verifications" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "acknowledgment_refreshes_pending_idx" ON "acknowledgment_refreshes" USING btree ("mode","resolved_at");--> statement-breakpoint
CREATE INDEX "acknowledgments_org_idx" ON "acknowledgments" USING btree ("org_id","mode","tax_year");--> statement-breakpoint
CREATE INDEX "acknowledgments_donor_idx" ON "acknowledgments" USING btree ("donor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "acknowledgments_version_uq" ON "acknowledgments" USING btree ("org_id","donor_id","tax_year","mode","version");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_sessions_token_uq" ON "checkout_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "checkout_sessions_org_idx" ON "checkout_sessions" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "donations_org_idx" ON "donations" USING btree ("org_id","mode","tax_year");--> statement-breakpoint
CREATE INDEX "donations_org_created_idx" ON "donations" USING btree ("org_id","mode","created_at");--> statement-breakpoint
CREATE INDEX "donations_donor_idx" ON "donations" USING btree ("donor_id");--> statement-breakpoint
CREATE INDEX "donations_checkout_idx" ON "donations" USING btree ("checkout_session_id");--> statement-breakpoint
CREATE INDEX "donations_payment_idx" ON "donations" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "donations_order_role_uq" ON "donations" USING btree ("checkout_session_id","order_number","taxpayer_role");--> statement-breakpoint
CREATE INDEX "donor_delivery_consents_donor_idx" ON "donor_delivery_consents" USING btree ("donor_id","org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "donor_numbers_uq" ON "donor_numbers" USING btree ("org_id","donor_id","tax_year","mode");--> statement-breakpoint
CREATE UNIQUE INDEX "donor_numbers_number_uq" ON "donor_numbers" USING btree ("org_id","tax_year","mode","number");--> statement-breakpoint
CREATE INDEX "donor_year_totals_org_idx" ON "donor_year_totals" USING btree ("org_id","mode","tax_year");--> statement-breakpoint
CREATE INDEX "donors_email_idx" ON "donors" USING btree ("email");--> statement-breakpoint
CREATE INDEX "donors_user_idx" ON "donors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fee_ledger_payer_idx" ON "fee_ledger" USING btree ("payer_org_id","status");--> statement-breakpoint
CREATE INDEX "fee_ledger_donation_idx" ON "fee_ledger" USING btree ("donation_id");--> statement-breakpoint
CREATE INDEX "fee_ledger_handoff_idx" ON "fee_ledger" USING btree ("handoff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_ledger_donation_kind_uq" ON "fee_ledger" USING btree ("donation_id","kind");--> statement-breakpoint
CREATE INDEX "irs_reports_org_idx" ON "irs_reports" USING btree ("org_id","tax_year");--> statement-breakpoint
CREATE UNIQUE INDEX "irs_reports_version_uq" ON "irs_reports" USING btree ("org_id","tax_year","mode","version");--> statement-breakpoint
CREATE INDEX "payments_processor_idx" ON "payments" USING btree ("processor","processor_payment_id");--> statement-breakpoint
CREATE INDEX "payments_checkout_idx" ON "payments" USING btree ("checkout_session_id");--> statement-breakpoint
CREATE INDEX "business_invoice_lines_invoice_idx" ON "business_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_invoices_number_uq" ON "business_invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "business_invoices_business_idx" ON "business_invoices" USING btree ("business_org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "handoffs_token_uq" ON "handoffs" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "handoffs_idempotency_uq" ON "handoffs" USING btree ("business_org_id","mode","idempotency_key");--> statement-breakpoint
CREATE INDEX "handoffs_business_idx" ON "handoffs" USING btree ("business_org_id","mode","created_at");--> statement-breakpoint
CREATE INDEX "handoffs_sgo_idx" ON "handoffs" USING btree ("sgo_org_id");--> statement-breakpoint
CREATE INDEX "handoffs_verification_idx" ON "handoffs" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "handoffs_hold_idx" ON "handoffs" USING btree ("status","hold_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partnerships_uq" ON "partnerships" USING btree ("business_org_id","sgo_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_uq" ON "idempotency_keys" USING btree ("org_id","key_hash");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys" USING btree ("expires_at");