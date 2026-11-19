/**
 * Proof of income: upload documents (with per-file status from the server, the IRS transcript how-to and the
 * no-income statements), connect a payroll or bank account (with the "upload instead" escape hatch), and the
 * statement-signing screen.
 */
import { CircleCheck, FileText, Landmark } from "lucide-react";
import { redirect } from "next/navigation";
import { Alert, Badge, Button, Disclosure, SubmitButton } from "@/components/ui";
import { pickBilingual } from "@/i18n";
import { isAppError } from "@/lib/errors";
import { customerFileNumberFor, getTranscriptGuide, listConnections, previewRailConsent, RAIL_POLICY, type RailConnectionView } from "@/server/rails";
import { MAX_UPLOAD_BYTES, UPLOAD_ACCEPT_ATTRIBUTE } from "@/server/storage";
import { certificationIncomeYear, DOCUMENT_LIMITS, previewCertification } from "@/server/verifications";
import { withdrawStatementAction } from "../actions";
import { AutoRefresh } from "../components/auto-refresh";
import { ConnectPanel } from "../components/connect-panel";
import { StatementForm } from "../components/forms";
import { HiddenFields } from "../components/hidden-fields";
import { UploadPanel } from "../components/upload-panel";
import { localizeError } from "../errors";
import { DOCUMENT_REFRESH_MS, MAX_FILES_PER_DROP } from "../policy";
import { firstParam, type FlowContext } from "../server/context";
import { activeDocuments, DocumentList, formFields, hrefFor, memberName, QueryError, ScreenHeading } from "./shared";
import { ConsentText, type ScreenProps } from "./steps";

function incomeYearOf(ctx: FlowContext): number {
  return ctx.verification.incomeYear ?? certificationIncomeYear({ applicationDate: ctx.verification.applicationDate });
}

/** What the scholarship organization or the last decision still needs (shown again on the upload screen). */
export function StillNeeded({ ctx }: { ctx: FlowContext }) {
  const s = ctx.t.status;
  const { missing, request } = ctx.view;
  if (missing.length === 0 && !request) return null;
  return (
    <Alert tone="warning" title={s.missingTitle} className="mb-6">
      {missing.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5">
          {missing.map((m, i) => (
            <li key={i}>{pickBilingual(m, ctx.locale)}</li>
          ))}
        </ul>
      ) : null}
      {request ? (
        <div className="mt-3">
          <p className="font-semibold">{s.requestTitle}</p>
          <p className="whitespace-pre-line">{request.message}</p>
          {request.items.length > 0 ? (
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {request.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Alert>
  );
}

/* ------------------------------------------------------------------------------------------ upload */

function TranscriptGuidePanel({ ctx }: { ctx: FlowContext }) {
  const guide = getTranscriptGuide(ctx.locale, { incomeYear: incomeYearOf(ctx), customerFileNumber: customerFileNumberFor(ctx.view.verificationId) });
  return (
    <Disclosure summary={ctx.t.upload.transcriptTitle} variant="card">
      <div className="space-y-4 text-fg">
        <p>{guide.intro}</p>
        <Alert tone="info" role="note">
          {guide.neverAsk}
        </Alert>
        {guide.customerFileNumber ? <p className="font-medium">{ctx.t.upload.transcriptNumber(guide.customerFileNumber)}</p> : null}
        <ol className="space-y-3">
          {guide.steps.map((step, i) => (
            <li key={step.id} className="flex gap-3">
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-sm font-semibold">
                {i + 1}
              </span>
              <div>
                <p className="font-semibold">{step.title}</p>
                <p className="text-fg-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        {guide.goodToKnow.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
            {guide.goodToKnow.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        ) : null}
        {guide.otherWays.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
            {guide.otherWays.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-fg-muted">{guide.screensMayDiffer}</p>
      </div>
    </Disclosure>
  );
}

function Statements({ ctx }: { ctx: FlowContext }) {
  const u = ctx.t.upload;
  const fields = formFields(ctx);
  const year = incomeYearOf(ctx);
  const adults = ctx.household.members.filter((m) => m.kind === "adult");
  const certs = ctx.view.certifications;
  const signedFor = (memberId: string) => certs.find((c) => c.kind === "zero_income" && c.memberId === memberId);
  const otherIncome = certs.find((c) => c.kind === "no_other_income");
  const withdraw = (certificationId: string, label: string) => (
    <form action={withdrawStatementAction}>
      <HiddenFields values={{ ...fields, certificationId, screen: "upload" }} />
      <SubmitButton variant="link">{label}</SubmitButton>
    </form>
  );
  return (
    <section aria-labelledby="statements" className="space-y-3">
      <h2 id="statements" className="text-lg font-semibold text-fg">
        {u.statementsTitle}
      </h2>
      <p className="text-fg-muted">{u.statementsLead(year)}</p>
      <ul className="space-y-2">
        {adults.map((m) => {
          const cert = signedFor(m.id);
          return (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line p-3">
              {cert ? (
                <>
                  <span className="flex items-center gap-2 text-fg">
                    <CircleCheck aria-hidden="true" className="size-5 text-success-600" />
                    {ctx.t.review.statementZero(memberName(m))}
                    <Badge tone="success">{u.signed}</Badge>
                  </span>
                  {withdraw(cert.id, u.withdraw)}
                </>
              ) : (
                <Button variant="link" href={hrefFor(ctx, "statement", { kind: "zero_income", member: m.id })} leadingIcon={<FileText aria-hidden="true" />}>
                  {u.noIncomeFor(memberName(m))}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="rounded-card border border-line p-3">
        <p className="font-medium text-fg">{u.otherIncomeTitle}</p>
        <p className="mt-1 text-sm text-fg-muted">{u.otherIncomeLead}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          {otherIncome ? (
            <>
              <span className="flex items-center gap-2 text-fg">
                <CircleCheck aria-hidden="true" className="size-5 text-success-600" />
                {ctx.t.review.statementOther}
                <Badge tone="success">{u.signed}</Badge>
              </span>
              {withdraw(otherIncome.id, u.withdraw)}
            </>
          ) : (
            <Button variant="link" href={hrefFor(ctx, "statement", { kind: "no_other_income" })} leadingIcon={<FileText aria-hidden="true" />}>
              {u.otherIncomeButton}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

export function UploadScreen({ ctx, query }: ScreenProps) {
  const u = ctx.t.upload;
  const active = activeDocuments(ctx.view.documents);
  const reading = active.some((d) => d.state === "reading");
  const remaining = DOCUMENT_LIMITS.maxActiveDocuments - active.length;
  const ready = ctx.state.evidenceCount > 0 || ctx.view.certifications.length > 0;
  return (
    <>
      <AutoRefresh intervalMs={DOCUMENT_REFRESH_MS} enabled={reading} />
      <ScreenHeading title={u.title} lead={u.lead} />
      <StillNeeded ctx={ctx} />
      <QueryError query={query} locale={ctx.locale} />
      <div className="space-y-8">
        <UploadPanel
          fields={formFields(ctx)}
          members={ctx.household.members.map((m) => ({ id: m.id, name: memberName(m) }))}
          accept={UPLOAD_ACCEPT_ATTRIBUTE}
          maxSizeBytes={MAX_UPLOAD_BYTES}
          maxFiles={Math.max(1, Math.min(MAX_FILES_PER_DROP, remaining))}
          incomeYear={incomeYearOf(ctx)}
        />
        <div className="space-y-2">
          <DocumentList ctx={ctx} documents={ctx.view.documents} returnTo="upload" />
          {reading ? (
            <p className="text-sm text-fg-muted" role="status">
              {u.reading}
            </p>
          ) : null}
        </div>
        <TranscriptGuidePanel ctx={ctx} />
        <Statements ctx={ctx} />
        <div className="flex flex-col gap-3 border-t border-line pt-6">
          <Button size="lg" fullWidth variant={ready ? "primary" : "secondary"} href={hrefFor(ctx, "review")}>
            {u.next}
          </Button>
          <Button variant="ghost" size="lg" fullWidth href={hrefFor(ctx, "connect")} leadingIcon={<Landmark aria-hidden="true" />}>
            {u.switchToConnect}
          </Button>
        </div>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------------------------------- connect */

const OPEN_RAIL_STATUSES: ReadonlySet<string> = new Set(["created", "connecting", "connected", "syncing", "ready"]);

/** The connection to show on reload: the newest one still open, else none (a fresh start). */
function currentConnection(connections: readonly RailConnectionView[]): RailConnectionView | null {
  for (let i = connections.length - 1; i >= 0; i--) if (OPEN_RAIL_STATUSES.has(connections[i]!.status)) return connections[i]!;
  return null;
}

export async function ConnectScreen({ ctx, query }: ScreenProps) {
  const c = ctx.t.connect;
  const actor = { userId: ctx.user.id };
  const [preview, connections] = await Promise.all([previewRailConsent(ctx.view.verificationId, actor, ctx.locale), listConnections(ctx.view.verificationId, actor)]);
  const connectable = RAIL_POLICY.connectableMemberKinds as readonly string[];
  // The owner connects their own account or one for an adult without a sign-in; another adult connects their own.
  const candidates = ctx.household.members
    .filter((m) => connectable.includes(m.kind) && m.kind !== "student")
    .filter((m) => (ctx.isOwner ? m.isOwner || (!m.hasSignIn && RAIL_POLICY.ownerMayConnectForMembersWithoutSignIn) : m.hasSignIn && !m.isOwner))
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
  const adults = candidates.map((m) => ({ id: m.id, name: m.isOwner ? `${memberName(m)} (${ctx.t.common.you})` : memberName(m) }));
  const ready = ctx.state.evidenceCount > 0;
  return (
    <>
      <ScreenHeading title={c.title} lead={c.lead} />
      <StillNeeded ctx={ctx} />
      <QueryError query={query} locale={ctx.locale} />
      <div className="space-y-8">
        <ConnectPanel
          fields={formFields(ctx)}
          adults={adults}
          consent={{ title: preview.rendered.title, paragraphs: preview.rendered.paragraphs, checkboxLabel: preview.rendered.checkboxLabel, sha256: preview.rendered.sha256 }}
          initialConnection={currentConnection(connections)}
          uploadHref={hrefFor(ctx, "upload")}
        />
        {ctx.view.rails.length > 0 ? (
          <section aria-labelledby="connections" className="space-y-3">
            <h2 id="connections" className="text-lg font-semibold text-fg">
              {ctx.t.review.connectionsTitle}
            </h2>
            <ul className="divide-y divide-line rounded-card border border-line">
              {ctx.view.rails.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <span className="font-medium text-fg">{r.providerName}</span>
                  <Badge tone={r.offerUpload ? "warning" : r.waiting ? "info" : "success"}>{pickBilingual(r.label, ctx.locale)}</Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {ready ? (
          <Button size="lg" fullWidth href={hrefFor(ctx, "review")}>
            {c.next}
          </Button>
        ) : null}
      </div>
    </>
  );
}

/* --------------------------------------------------------------------------------------- statement */

export async function StatementScreen({ ctx, query }: ScreenProps) {
  const t = ctx.t;
  const kind = firstParam(query.kind);
  const uploadHref = hrefFor(ctx, "upload");
  if (kind !== "zero_income" && kind !== "no_other_income") redirect(uploadHref);
  const memberParam = firstParam(query.member) ?? null;
  const member = memberParam ? ctx.household.members.find((m) => m.id === memberParam && m.kind === "adult") : undefined;
  if (kind === "zero_income" && !member) redirect(uploadHref);
  const memberId = kind === "zero_income" ? member!.id : null;

  let rendered: Awaited<ReturnType<typeof previewCertification>>;
  try {
    rendered = await previewCertification(ctx.view.verificationId, { userId: ctx.user.id }, { kind, memberId, locale: ctx.locale });
  } catch (e) {
    if (!isAppError(e)) throw e;
    return (
      <>
        <ScreenHeading title={t.statement.title} />
        <Alert tone="warning" role="alert" className="mb-6">
          {localizeError(e, ctx.locale).error.message}
        </Alert>
        <Button variant="secondary" size="lg" fullWidth href={uploadHref}>
          {t.statement.back}
        </Button>
      </>
    );
  }
  return (
    <>
      <ScreenHeading title={t.statement.title} lead={t.statement.lead} />
      <div className="space-y-6">
        <ConsentText rendered={rendered} headingId="statement-text" />
        <StatementForm fields={formFields(ctx)} kind={kind} memberId={memberId} sha={rendered.sha256} checkboxLabel={rendered.checkboxLabel} />
        <Button variant="ghost" size="lg" fullWidth href={uploadHref}>
          {t.statement.back}
        </Button>
      </div>
    </>
  );
}
