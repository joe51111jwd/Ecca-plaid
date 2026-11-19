import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, DateTime, Drawer, PageHeader, StatusBadge, Timeline } from "@/components/ui";
import { INCOME_CATEGORIES } from "@/engine/income";
import { now } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { roleAtLeast } from "@/server/auth";
import { AWARD_PAYMENT_METHODS, getAwardContext, listAwards } from "@/server/awards";
import { applicantLabels, getVerificationDetail, INCOME_MEASURES } from "@/server/verifications";
import { DownloadLink } from "@/features/sgo/components/DownloadLink";
import { HashValue } from "@/features/sgo/components/HashValue";
import { AwardPanel } from "@/features/sgo/components/verification/AwardPanel";
import { DecisionPanel } from "@/features/sgo/components/verification/DecisionPanel";
import { DocumentsPanel } from "@/features/sgo/components/verification/DocumentsPanel";
import { HouseholdPanel } from "@/features/sgo/components/verification/HouseholdPanel";
import { IncomePanel } from "@/features/sgo/components/verification/IncomePanel";
import { ReviewerPanel } from "@/features/sgo/components/verification/ReviewerPanel";
import { summarizeDecision } from "@/features/sgo/decision-summary";
import { measureLabel } from "@/features/sgo/forms";
import { SGO_PATHS } from "@/features/sgo/nav";
import { REVIEW_ROLE } from "@/features/sgo/policy";
import { canOpenUploads, requireSgoPage } from "@/features/sgo/server/context";
import { loadTeam, teamNames } from "@/features/sgo/server/queries";
import { timelineActor, timelineLabel } from "@/features/sgo/timeline";
import {
  addIncomeLineAction,
  assignReviewAction,
  cancelVerificationAction,
  keyFieldsAction,
  offerAwardAction,
  removeIncomeLineAction,
  requestMoreInfoAction,
  rerunAction,
  resolveReviewAction,
  updateAwardStatusAction,
} from "../../_actions";

export const metadata: Metadata = { title: "Verification" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const MEASURE_KIND: ReadonlyArray<[string, string]> = [
  ["w2_", "w2"],
  ["paystub_", "pay_stub"],
  ["f1040_", "tax_return"],
  ["transcript_", "irs_transcript"],
  ["wai_", "irs_transcript"],
];

export default async function VerificationDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const path = SGO_PATHS.verification(id);
  const ctx = await requireSgoPage(path);

  let detail;
  try {
    // Scoped to the dashboard's organization AND mode: another SGO's id, or the other mode's, is not found.
    detail = await getVerificationDetail(ctx.org.id, id, { type: "user", id: ctx.user.id, mode: ctx.mode, request: ctx.actor.request });
  } catch (e) {
    if (isAppError(e) && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  }

  const v = detail.verification;
  const canReview = roleAtLeast(ctx.role, REVIEW_ROLE);
  const editable = canReview && (v.status === "needs_review" || (v.status === "pending" && v.stage === "awaiting_family"));
  const [team, awardContext, awards] = await Promise.all([loadTeam(ctx.actor), getAwardContext(ctx.org.id, v.id, { mode: ctx.mode }), listAwards(ctx.org.id, { mode: ctx.mode, verificationId: v.id })]);
  const names = teamNames(team);
  const members = new Map((detail.household?.members ?? []).map((m) => [m.id, `${m.firstName} ${m.lastName}`]));
  const memberName = (memberId: string | null) => (memberId ? (members.get(memberId) ?? "a former household member") : "the household");
  const summary = summarizeDecision(detail.decision);
  const viewId = typeof query.view === "string" ? query.view : null;
  const canViewFiles = canOpenUploads(ctx.role);
  const viewing = viewId && canViewFiles ? (detail.documents.find((d) => d.id === viewId && d.viewable) ?? null) : null;
  const fileHref = (documentId: string) => `${path}/documents/${encodeURIComponent(documentId)}`;
  const reviewers = team.filter((m) => roleAtLeast(m.membership.role, REVIEW_ROLE)).map((m) => ({ id: m.user.id, name: m.user.name?.trim() || m.user.email }));
  const students = (detail.household?.members ?? []).filter((m) => detail.household?.studentMemberIds.includes(m.id)).map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}` }));
  const measureOptions = INCOME_MEASURES.map((m) => ({ value: m, label: measureLabel(m), kind: MEASURE_KIND.find(([p]) => m.startsWith(p))?.[1] ?? "" }));
  const categories = INCOME_CATEGORIES.map((c) => ({ key: c.key, label: c.label.en }));
  // The same name the lists use: the SGO's, the family's own, or the camp and booking for a handoff.
  const owner = detail.household?.members.find((m) => m.isOwner);
  const title = v.applicantName ?? (owner ? `${owner.firstName} ${owner.lastName}` : (await applicantLabels(ctx.org.id, [{ ...v, householdId: null }]))[v.id]) ?? "Verification";
  const decided = v.status === "eligible" || v.status === "ineligible";

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        back={{ href: SGO_PATHS.verifications, label: "Verifications" }}
        description={
          <>
            {v.externalRef ? `Your reference ${v.externalRef} · ` : ""}
            {[v.studentFirstName, v.studentLastName].filter(Boolean).length > 0 ? `Student ${[v.studentFirstName, v.studentLastName].filter(Boolean).join(" ")} · ` : ""}
            Created <DateTime value={v.createdAt} format="dateTime" /> · <HashValue value={v.id} label="verification id" />
          </>
        }
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="verification" status={v.status} provisional={v.provisional && decided} />
            <StatusBadge kind="stage" status={v.stage} size="sm" />
            {v.passport ? <span className="text-xs text-fg-muted">Reused result of {v.passport.sourceVerificationId}</span> : null}
          </div>
        }
      />

      {v.flags.length > 0 ? (
        <Alert tone="warning" title="Flags on this verification">
          <ul className="list-disc space-y-1 pl-5">
            {v.flags.map((f) => (
              <li key={f.code}>{f.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <DecisionPanel detail={detail} summary={summary} evidenceHref={(kind) => `${path}/evidence/${kind}`} />
          <DocumentsPanel
            detail={detail}
            orgId={ctx.org.id}
            mode={ctx.mode}
            canEdit={editable}
            canViewFiles={canViewFiles}
            viewHref={(documentId) => `${path}?view=${encodeURIComponent(documentId)}#documents`}
            memberName={memberName}
            measureOptions={measureOptions}
            keyFieldsAction={keyFieldsAction}
          />
          <IncomePanel detail={detail} orgId={ctx.org.id} mode={ctx.mode} canEdit={editable} memberName={memberName} categories={categories} addIncomeLineAction={addIncomeLineAction} removeIncomeLineAction={removeIncomeLineAction} />
        </div>
        <div className="space-y-6">
          {canReview ? (
            <ReviewerPanel
              detail={detail}
              orgId={ctx.org.id}
              mode={ctx.mode}
              currentUserId={ctx.user.id}
              reviewers={reviewers}
              editable={editable}
              actions={{ resolve: resolveReviewAction, requestMoreInfo: requestMoreInfoAction, rerun: rerunAction, assign: assignReviewAction, cancel: cancelVerificationAction }}
            />
          ) : null}
          <AwardPanel
            orgId={ctx.org.id}
            mode={ctx.mode}
            verificationId={v.id}
            context={awardContext}
            awards={awards.data}
            canDecide={canReview}
            paymentMethods={AWARD_PAYMENT_METHODS}
            students={students}
            offerAction={offerAwardAction}
            statusAction={updateAwardStatusAction}
          />
          <HouseholdPanel detail={detail} memberName={memberName} />
          <section aria-labelledby="timeline-heading" className="rounded-card border border-line bg-surface p-5">
            <h2 id="timeline-heading" className="mb-4 text-lg font-semibold text-fg">
              Timeline
            </h2>
            <Timeline
              label="Verification history"
              format="relative"
              now={now()}
              items={[...detail.timeline].reverse().map((e) => ({ id: e.id, title: timelineLabel(e.type), at: e.createdAt, actor: timelineActor(e.actorType, e.actorId, names) }))}
            />
          </section>
        </div>
      </div>

      <Drawer open={viewing !== null} closeHref={path} size="lg" title={viewing?.filename ?? "Document"} description="Opening this file is recorded in your organization's audit log.">
        {viewing ? (
          <div className="space-y-3">
            {viewing.contentType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element -- an audited, private, per-request file: next/image would cache and re-serve it
              <img src={fileHref(viewing.id)} alt={`Uploaded file ${viewing.filename}`} className="max-h-[75vh] w-full rounded-card border border-line object-contain" />
            ) : viewing.contentType === "application/pdf" ? (
              // Same-origin framing is allowed (X-Frame-Options SAMEORIGIN); the browser's own PDF viewer renders it.
              <iframe src={fileHref(viewing.id)} title={`Uploaded file ${viewing.filename}`} className="h-[75vh] w-full rounded-card border border-line bg-sunken" />
            ) : (
              <p className="text-sm">This kind of file cannot be shown in the browser.</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-fg-muted">
              <span className="inline-flex items-center gap-1">
                SHA-256 <HashValue value={viewing.sha256} label={`SHA-256 of ${viewing.filename}`} />
              </span>
              <DownloadLink href={fileHref(viewing.id)} newTab>
                {viewing.contentType === "application/pdf" ? "Not showing? Open in a new tab" : "Open in a new tab"}
              </DownloadLink>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
