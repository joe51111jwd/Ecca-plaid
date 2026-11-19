import type { MemberRole } from "@/db/schema";

/** Dashboard wording for stored values that have no StatusBadge kind. Pure. */

export const ROLE_LABELS: Readonly<Record<MemberRole, { label: string; description: string }>> = Object.freeze({
  owner: { label: "Owner", description: "Everything an admin can do, and manages owners." },
  admin: { label: "Admin", description: "Settings, policy, API keys, webhooks, team, donor numbers, acknowledgments and the IRS report." },
  reviewer: { label: "Reviewer", description: "Reviews and decides verifications, asks families for more, offers awards." },
  viewer: { label: "Viewer", description: "Sees everything; changes nothing." },
});

export function roleLabel(role: MemberRole): string {
  return ROLE_LABELS[role]?.label ?? role;
}

export const DOCUMENT_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  award_letter: "Benefits award letter",
  tax_return: "Tax return",
  irs_transcript: "IRS transcript",
  w2: "Form W-2",
  pay_stub: "Pay stub",
  other_income: "Other income document",
  unknown: "Unrecognized document",
});

export function documentKindLabel(kind: string | null | undefined): string {
  if (!kind) return "Not detected";
  return DOCUMENT_KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

export const PROGRAM_LABELS: Readonly<Record<string, string>> = Object.freeze({
  SNAP: "SNAP",
  TANF: "TANF",
  WIC: "WIC",
  SECTION_8: "Section 8 housing",
  SSI: "SSI",
});

export const APPROVAL_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  approved: "Approved",
  denied: "Denied",
  terminated: "Terminated",
  pending: "Pending application",
  unclear: "Unclear",
});

export const PAYMENT_METHOD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  direct_to_vendor: "Paid directly to the school or vendor",
  qualified_digital_wallet: "Qualified digital wallet",
  other: "Other (your own procedure)",
});

export const WORKLIST_ACTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  add_sgo_ein: "EIN missing",
  register_portal: "Register in the IRS portal",
  enter_donor_number: "Donor number missing",
  generate_sandbox_number: "Donor number missing",
  review: "Needs a person",
  issue: "Ready to issue",
  mail_paper: "Paper required: mail it",
  none: "Done",
});

export const WORKLIST_ACTION_TONES: Readonly<Record<string, "danger" | "warning" | "info" | "success" | "neutral">> = Object.freeze({
  add_sgo_ein: "danger",
  register_portal: "danger",
  enter_donor_number: "warning",
  generate_sandbox_number: "warning",
  review: "warning",
  issue: "info",
  mail_paper: "warning",
  none: "success",
});

export const MEMBER_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  adult: "Adult",
  student: "Student",
  child: "Child",
  other: "Other household member",
});

export function memberKindLabel(kind: string): string {
  return MEMBER_KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

/** Joins a list of reasons into one readable line. */
export function joinReasons(reasons: ReadonlyArray<{ message: string }>): string {
  return reasons.map((r) => r.message).join(" ");
}
