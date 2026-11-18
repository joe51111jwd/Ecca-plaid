import {
  Archive,
  Award,
  Ban,
  BadgeCheck,
  CalendarClock,
  CircleCheck,
  CircleDashed,
  CircleDollarSign,
  CirclePause,
  CircleSlash,
  CircleX,
  Clock,
  CreditCard,
  Eraser,
  Eye,
  FileCheck,
  FileUp,
  FileWarning,
  FileX,
  FlaskConical,
  FolderOpen,
  Hourglass,
  Inbox,
  Landmark,
  ListChecks,
  LoaderCircle,
  MailCheck,
  OctagonAlert,
  PenLine,
  Plug,
  Radio,
  Receipt,
  RefreshCw,
  ScanText,
  Send,
  ShieldCheck,
  TimerOff,
  TriangleAlert,
  Undo2,
  Unplug,
  UserRoundCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { HandoffStatus, InvoiceStatus, partnerships } from "@/db/schema/business";
import type { DeliveryStatus, EmailStatus, JobStatus, OrgStatus, webhookEndpoints } from "@/db/schema/core";
import type { acknowledgments, CheckoutStatus, donations, feeLedger, PaymentStatus } from "@/db/schema/donation";
import type { sgoListEntries, SgoListSource } from "@/db/schema/sgo";
import type { Mode } from "@/db/schema/_shared";
import type { AwardStatus, DocumentStatus, RailStatus, reviewTasks, ThresholdSource, VerificationMethod, VerificationStage, VerificationStatus } from "@/db/schema/verification";
import type { Tone } from "./badge";
import type { UiLocale } from "./locale";

/**
 * Every status-like value in the data model, by kind. The value unions come straight from the schema
 * (type-only imports — nothing from the database layer reaches the browser), so adding a status there
 * fails the type check here until it has a label, a tone and an icon.
 */
export interface StatusKinds {
  /** verifications.status — the public result. */
  verification: VerificationStatus;
  /** verifications.stage — where a pending verification is. */
  stage: VerificationStage;
  /** verifications.method */
  method: VerificationMethod;
  /** verifications.threshold_source — whether the income limit is HUD-derived (provisional) or IRS-published. */
  threshold_source: ThresholdSource;
  /** documents.status */
  document: DocumentStatus;
  /** rail_connections.status */
  rail: RailStatus;
  /** review_tasks.status */
  review_task: (typeof reviewTasks.$inferSelect)["status"];
  /** awards.status */
  award: AwardStatus;
  /** handoffs.status — the point-of-booking lifecycle. */
  handoff: HandoffStatus;
  /** partnerships.status */
  partnership: (typeof partnerships.$inferSelect)["status"];
  /** business_invoices.status */
  invoice: InvoiceStatus;
  /** checkout_sessions.status */
  checkout: CheckoutStatus;
  /** payments.status */
  payment: PaymentStatus;
  /** donations.status */
  donation: (typeof donations.$inferSelect)["status"];
  /** acknowledgments.status */
  acknowledgment: (typeof acknowledgments.$inferSelect)["status"];
  /** fee_ledger.status */
  fee: (typeof feeLedger.$inferSelect)["status"];
  /** sgo_list_entries.status */
  sgo_list: (typeof sgoListEntries.$inferSelect)["status"];
  /** sgo_list_entries.source */
  sgo_list_source: SgoListSource;
  /** organizations.status */
  org: OrgStatus;
  /** webhook_endpoints.status */
  webhook_endpoint: (typeof webhookEndpoints.$inferSelect)["status"];
  /** webhook_deliveries.status */
  webhook_delivery: DeliveryStatus;
  /** jobs.status */
  job: JobStatus;
  /** emails.status */
  email: EmailStatus;
  /** mode — sandbox data versus real data. */
  mode: Mode;
}

export type StatusKind = keyof StatusKinds;

export interface StatusSpec {
  /** The words on the badge. Plain language, not the stored value. */
  label: string;
  /** Spanish label, for the kinds families see. Staff-only kinds have none and fall back to English. */
  labelEs?: string;
  tone: Tone;
  icon: LucideIcon;
  /** One sentence on what the status means and what it does not. Shown as the badge tooltip. */
  description: string;
}

type StatusMap = { [K in StatusKind]: Record<StatusKinds[K], StatusSpec> };

export const STATUS_MAP: StatusMap = {
  verification: {
    pending: { label: "Pending", labelEs: "Pendiente", tone: "info", icon: Clock, description: "No decision yet. The stage says what is still needed." },
    eligible: { label: "Eligible", labelEs: "Elegible", tone: "success", icon: CircleCheck, description: "Household income is at or under the limit used. This is not an award." },
    ineligible: { label: "Not eligible", labelEs: "No elegible", tone: "danger", icon: CircleSlash, description: "The evidence shows household income over the limit used." },
    needs_review: { label: "Needs review", labelEs: "Requiere revisión", tone: "warning", icon: Eye, description: "A reviewer at the scholarship organization has to look before there is a decision." },
    expired: { label: "Expired", labelEs: "Vencido", tone: "neutral", icon: TimerOff, description: "The result is past its validity date and can no longer be relied on or reused." },
    canceled: { label: "Canceled", labelEs: "Cancelado", tone: "neutral", icon: Ban, description: "The verification was canceled before a decision." },
  },
  stage: {
    created: { label: "Link not opened", labelEs: "Enlace sin abrir", tone: "neutral", icon: Send, description: "The scholarship organization created the verification; the family has not opened the link." },
    started: { label: "Opened", labelEs: "Abierto", tone: "info", icon: FolderOpen, description: "The family opened the link." },
    consented: { label: "Consent given", labelEs: "Consentimiento otorgado", tone: "info", icon: UserRoundCheck, description: "The family agreed to share the result with this organization." },
    household: { label: "Household complete", labelEs: "Hogar completado", tone: "info", icon: UsersRound, description: "The household form is complete." },
    collecting: { label: "Collecting documents", labelEs: "Reuniendo documentos", tone: "info", icon: FileUp, description: "The family is uploading documents or connecting an account." },
    submitted: { label: "Submitted", labelEs: "Enviado", tone: "info", icon: Inbox, description: "The family submitted. Processing has not finished." },
    processing: { label: "Processing", labelEs: "En proceso", tone: "info", icon: LoaderCircle, description: "Documents are being read and the decision is being computed." },
    awaiting_family: { label: "Waiting on family", labelEs: "Falta información", tone: "warning", icon: Hourglass, description: "More information is needed from the family before a decision." },
    in_review: { label: "In review", labelEs: "En revisión", tone: "warning", icon: Eye, description: "Waiting on a reviewer at the scholarship organization." },
    decided: { label: "Decided", labelEs: "Decidido", tone: "neutral", icon: ListChecks, description: "A decision was recorded. See the status for the result." },
  },
  method: {
    direct: { label: "Direct", tone: "neutral", icon: Receipt, description: "Income verified from income documents or a consented data connection." },
    categorical: { label: "Categorical", tone: "neutral", icon: Landmark, description: "Verified from a recent award letter for a qualifying benefit program." },
  },
  threshold_source: {
    hud_provisional: { label: "HUD-derived, provisional", tone: "caution", icon: CircleDashed, description: "The limit comes from HUD income-limit data because the IRS has not published its table." },
    irs_published: { label: "IRS published", tone: "neutral", icon: BadgeCheck, description: "The limit comes from the table published by the IRS." },
  },
  document: {
    uploaded: { label: "Uploaded", labelEs: "Subido", tone: "info", icon: FileUp, description: "Received. Not read yet." },
    extracting: { label: "Reading", labelEs: "Leyendo", tone: "info", icon: ScanText, description: "The document is being read." },
    extracted: { label: "Read", labelEs: "Leído", tone: "success", icon: FileCheck, description: "The fields were read with enough confidence to use." },
    needs_review: { label: "Needs review", labelEs: "Requiere revisión", tone: "warning", icon: FileWarning, description: "The document could not be read confidently. A reviewer must key or confirm the fields." },
    rejected: { label: "Rejected", labelEs: "Rechazado", tone: "danger", icon: FileX, description: "The document cannot be used (wrong type, unreadable, or outside the allowed dates)." },
    purged: { label: "File deleted", labelEs: "Archivo eliminado", tone: "neutral", icon: Eraser, description: "The raw file was deleted under the retention policy. Its hash and extracted fields are kept." },
  },
  rail: {
    created: { label: "Not connected", labelEs: "Sin conectar", tone: "neutral", icon: Unplug, description: "A connection was started but nothing is linked yet." },
    connecting: { label: "Connecting", labelEs: "Conectando", tone: "info", icon: Plug, description: "The family is in the provider's connection flow." },
    connected: { label: "Connected", labelEs: "Conectado", tone: "info", icon: Plug, description: "Linked. Income data has not arrived yet." },
    syncing: { label: "Syncing", labelEs: "Sincronizando", tone: "info", icon: RefreshCw, description: "Income data is being retrieved." },
    ready: { label: "Ready", labelEs: "Listo", tone: "success", icon: CircleCheck, description: "The income report is available to the decision engine." },
    failed: { label: "Failed", labelEs: "Falló", tone: "danger", icon: CircleX, description: "The connection failed. The family can upload documents instead." },
    declined: { label: "Declined", labelEs: "Rechazado por la familia", tone: "neutral", icon: Ban, description: "The family chose not to connect. They can upload documents instead." },
    revoked: { label: "Disconnected", labelEs: "Desconectado", tone: "neutral", icon: Unplug, description: "Access was withdrawn." },
  },
  review_task: {
    open: { label: "Open", tone: "warning", icon: Eye, description: "Waiting for a reviewer." },
    resolved: { label: "Resolved", tone: "success", icon: CircleCheck, description: "A reviewer recorded an outcome." },
  },
  award: {
    offered: { label: "Offered", labelEs: "Ofrecida", tone: "info", icon: Award, description: "The scholarship organization offered an award. The family has not accepted yet." },
    accepted: { label: "Accepted", labelEs: "Aceptada", tone: "brand", icon: CircleCheck, description: "The family accepted. Payment has not been made." },
    paid: { label: "Paid", labelEs: "Pagada", tone: "success", icon: CircleDollarSign, description: "The scholarship organization paid the award." },
    declined: { label: "Declined", labelEs: "Rechazada", tone: "neutral", icon: Ban, description: "The family declined the award." },
    revoked: { label: "Revoked", labelEs: "Revocada", tone: "danger", icon: CircleX, description: "The scholarship organization withdrew the award." },
  },
  handoff: {
    started: { label: "Started", labelEs: "Iniciado", tone: "info", icon: Send, description: "The family started from the booking page." },
    verifying: { label: "Verifying", labelEs: "Verificando", tone: "info", icon: LoaderCircle, description: "Income verification is in progress." },
    held: { label: "Spot held", labelEs: "Lugar reservado", tone: "brand", icon: CirclePause, description: "The reservation is held for the stated window while verification finishes." },
    eligible: { label: "Eligible", labelEs: "Elegible", tone: "info", icon: ShieldCheck, description: "Income is verified. An award is a separate decision by the scholarship organization — not a promise of payment." },
    awarded: { label: "Awarded", labelEs: "Beca otorgada", tone: "success", icon: Award, description: "The scholarship organization made an award for this booking." },
    completed: { label: "Completed", labelEs: "Completado", tone: "success", icon: CircleCheck, description: "The booking was completed with scholarship funds." },
    declined: { label: "Declined", labelEs: "No aprobado", tone: "neutral", icon: CircleSlash, description: "Not eligible, or the scholarship organization did not make an award." },
    expired: { label: "Hold expired", labelEs: "Reserva vencida", tone: "neutral", icon: TimerOff, description: "The hold window passed before a result." },
    canceled: { label: "Canceled", labelEs: "Cancelado", tone: "neutral", icon: Ban, description: "The family or the business canceled." },
  },
  partnership: {
    pending: { label: "Pending", tone: "warning", icon: Hourglass, description: "Waiting for the other organization to accept." },
    active: { label: "Active", tone: "success", icon: CircleCheck, description: "The scholarship organization accepts applicants from this business." },
    ended: { label: "Ended", tone: "neutral", icon: Ban, description: "The partnership is no longer active." },
  },
  invoice: {
    draft: { label: "Draft", tone: "neutral", icon: PenLine, description: "Not sent yet." },
    open: { label: "Open", tone: "info", icon: Receipt, description: "Sent to the business and awaiting payment." },
    paid: { label: "Paid", tone: "success", icon: CircleCheck, description: "Paid in full." },
    void: { label: "Void", tone: "neutral", icon: Ban, description: "Canceled. Nothing is owed." },
    uncollectible: { label: "Uncollectible", tone: "danger", icon: CircleX, description: "Written off as unlikely to be paid." },
  },
  checkout: {
    open: { label: "Open", tone: "info", icon: FolderOpen, description: "The donor is still filling in the checkout." },
    awaiting_payment: { label: "Awaiting payment", tone: "info", icon: CreditCard, description: "Details are complete. Payment has not been confirmed." },
    completed: { label: "Completed", tone: "success", icon: CircleCheck, description: "Payment succeeded and the contribution was recorded." },
    expired: { label: "Expired", tone: "neutral", icon: TimerOff, description: "The session timed out before payment." },
    canceled: { label: "Canceled", tone: "neutral", icon: Ban, description: "The donor left without paying." },
  },
  payment: {
    requires_payment: { label: "Awaiting payment", tone: "neutral", icon: CreditCard, description: "No payment method has been confirmed." },
    processing: { label: "Processing", tone: "info", icon: LoaderCircle, description: "The processor is working on the charge." },
    succeeded: { label: "Paid", tone: "success", icon: CircleCheck, description: "The charge succeeded." },
    failed: { label: "Failed", tone: "danger", icon: CircleX, description: "The charge did not go through." },
    canceled: { label: "Canceled", tone: "neutral", icon: Ban, description: "The payment was canceled before a charge." },
    refunded: { label: "Refunded", tone: "neutral", icon: Undo2, description: "The charge was returned to the payer." },
  },
  donation: {
    pending: { label: "Pending", tone: "info", icon: Clock, description: "Recorded, waiting for the payment to succeed." },
    succeeded: { label: "Received", tone: "success", icon: CircleCheck, description: "The contribution was paid." },
    failed: { label: "Failed", tone: "danger", icon: CircleX, description: "The payment did not go through. No contribution was made." },
    canceled: { label: "Canceled", tone: "neutral", icon: Ban, description: "Canceled before payment." },
    refunded: { label: "Refunded", tone: "neutral", icon: Undo2, description: "The contribution was returned to the donor." },
  },
  acknowledgment: {
    draft: { label: "Draft", tone: "neutral", icon: PenLine, description: "Prepared but not issued to the donor." },
    issued: { label: "Issued", tone: "success", icon: MailCheck, description: "The written acknowledgment was issued to the donor." },
    superseded: { label: "Superseded", tone: "neutral", icon: Archive, description: "Replaced by a newer version for the same tax year." },
    blocked: { label: "Blocked", tone: "warning", icon: OctagonAlert, description: "Cannot be issued until the stated problem is fixed." },
  },
  fee: {
    accrued: { label: "Accrued", tone: "neutral", icon: CalendarClock, description: "Owed, not invoiced yet." },
    invoiced: { label: "Invoiced", tone: "info", icon: Receipt, description: "On an invoice awaiting payment." },
    paid: { label: "Paid", tone: "success", icon: CircleCheck, description: "The fee was paid." },
    waived: { label: "Waived", tone: "neutral", icon: CircleSlash, description: "The platform chose not to charge it." },
    void: { label: "Void", tone: "neutral", icon: Ban, description: "Canceled. Nothing is owed." },
  },
  sgo_list: {
    listed: { label: "Listed", tone: "success", icon: BadgeCheck, description: "On the list this entry came from." },
    removed: { label: "Removed", tone: "danger", icon: CircleX, description: "Removed from the list. Gifts must not be taken for this organization." },
  },
  sgo_list_source: {
    provisional_curated: { label: "Provisional list", tone: "caution", icon: CircleDashed, description: "From the curated provisional list, used until the IRS publishes its list." },
    irs_published: { label: "IRS list", tone: "neutral", icon: BadgeCheck, description: "From the list published by the IRS." },
  },
  org: {
    pending: { label: "Pending", tone: "warning", icon: Hourglass, description: "Awaiting approval by a platform admin." },
    active: { label: "Active", tone: "success", icon: CircleCheck, description: "Can use the platform." },
    suspended: { label: "Suspended", tone: "danger", icon: Ban, description: "Access is suspended." },
  },
  webhook_endpoint: {
    active: { label: "Active", tone: "success", icon: Radio, description: "Receiving events." },
    disabled: { label: "Disabled", tone: "neutral", icon: CirclePause, description: "Not receiving events." },
  },
  webhook_delivery: {
    pending: { label: "Pending", tone: "info", icon: Clock, description: "Queued or waiting for the next attempt." },
    succeeded: { label: "Delivered", tone: "success", icon: CircleCheck, description: "The endpoint answered with a success status." },
    failed: { label: "Retrying", tone: "warning", icon: RefreshCw, description: "The last attempt failed. It will be retried." },
    dead: { label: "Failed", tone: "danger", icon: CircleX, description: "Every attempt failed. It will not be retried automatically." },
  },
  job: {
    queued: { label: "Queued", tone: "neutral", icon: Clock, description: "Waiting to run." },
    running: { label: "Running", tone: "info", icon: LoaderCircle, description: "In progress right now." },
    succeeded: { label: "Succeeded", tone: "success", icon: CircleCheck, description: "Finished without an error." },
    failed: { label: "Retrying", tone: "warning", icon: RefreshCw, description: "The last attempt failed. It will be retried." },
    dead: { label: "Failed", tone: "danger", icon: CircleX, description: "Out of attempts. Needs a person." },
  },
  email: {
    queued: { label: "Queued", tone: "neutral", icon: Clock, description: "Waiting to be sent." },
    sent: { label: "Sent", tone: "success", icon: MailCheck, description: "Handed to the email provider (or written to the local outbox)." },
    failed: { label: "Failed", tone: "danger", icon: TriangleAlert, description: "The provider rejected it." },
  },
  mode: {
    test: { label: "Test mode", labelEs: "Modo de prueba", tone: "caution", icon: FlaskConical, description: "Sandbox data. No money moves and nothing here is a real record." },
    live: { label: "Live", labelEs: "En vivo", tone: "success", icon: Radio, description: "Real records. Actions here affect real people and real money." },
  },
};

/** Every value of every kind, in lifecycle order — ready for filter menus and select options. */
export const STATUS_VALUES = Object.fromEntries(Object.entries(STATUS_MAP).map(([kind, specs]) => [kind, Object.keys(specs)])) as unknown as { readonly [K in StatusKind]: ReadonlyArray<StatusKinds[K]> };

export const STATUS_KINDS = Object.keys(STATUS_MAP) as StatusKind[];

/** The spec for a status, or null when the value is not one this build knows (render the raw value, never crash). */
export function statusSpec<K extends StatusKind>(kind: K, status: StatusKinds[K] | (string & {})): StatusSpec | null {
  const specs: Record<string, StatusSpec> | undefined = STATUS_MAP[kind];
  return specs && Object.hasOwn(specs, status) ? specs[status] : null;
}

/** The badge wording for a status. Unknown values are shown as written, with underscores as spaces. */
export function statusLabel<K extends StatusKind>(kind: K, status: StatusKinds[K] | (string & {}), locale: UiLocale = "en"): string {
  const spec = statusSpec(kind, status);
  if (!spec) return String(status).replace(/_/g, " ");
  return locale === "es" && spec.labelEs ? spec.labelEs : spec.label;
}
