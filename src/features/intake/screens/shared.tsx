/**
 * Small server-rendered pieces shared by the family screens: the heading block, notices carried in the URL after a
 * redirect, and the list of documents the server holds.
 */
import type { ReactNode } from "react";
import { Alert, Badge, ConfirmButton, type Tone } from "@/components/ui";
import { getDictionary, pickBilingual, type Dictionary, type Locale } from "@/i18n";
import type { FamilyViewDocument } from "@/server/verifications";
import { removeDocumentAction } from "../actions";
import type { FlowFormFields } from "../components/hidden-fields";
import { firstParam, type FlowContext, type SearchParams } from "../server/context";
import { screenHref, type Screen } from "../flow";

/** Title and one-sentence lead at the top of a screen. The only h1 on the page. */
export function ScreenHeading({ title, lead, eyebrow }: { title: ReactNode; lead?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6 space-y-2">
      {eyebrow ? <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase">{eyebrow}</p> : null}
      <h1 className="text-2xl leading-tight font-semibold text-balance text-fg sm:text-3xl">{title}</h1>
      {lead ? <p className="text-base leading-relaxed text-fg-muted">{lead}</p> : null}
    </header>
  );
}

/** The hidden fields every form of this flow posts. */
export function formFields(ctx: FlowContext): FlowFormFields {
  return { base: ctx.base, v: ctx.view.verificationId, lang: ctx.locale };
}

/** `{base}/{screen}` in the family's language (Spanish keeps `?lang=es` so a shared or reloaded URL stays Spanish). */
export function hrefFor(ctx: Pick<FlowContext, "base" | "locale">, screen: Screen, query: Record<string, string | null | undefined> = {}): string {
  return screenHref(ctx.base, screen, ctx.locale === "es" ? { ...query, lang: "es" } : query);
}

type ErrorKey = Exclude<keyof Dictionary["errors"], "title" | "files" | "fields">;

/** A dictionary error key carried in `?error=` after a redirect, or null when it is not one of ours. */
export function errorFromQuery(query: SearchParams, locale: Locale): string | null {
  const key = firstParam(query.error);
  if (!key) return null;
  const errors = getDictionary(locale).errors;
  if (key === "title" || key === "files" || key === "fields" || !Object.prototype.hasOwnProperty.call(errors, key)) return null;
  const value = errors[key as ErrorKey];
  return typeof value === "string" ? value : null;
}

/** Shows an error carried in the URL (from an action that redirected back here). */
export function QueryError({ query, locale }: { query: SearchParams; locale: Locale }) {
  const message = errorFromQuery(query, locale);
  if (!message) return null;
  return (
    <Alert tone="danger" role="alert" className="mb-5" title={getDictionary(locale).errors.title}>
      {message}
    </Alert>
  );
}

const DOCUMENT_TONE: Readonly<Record<FamilyViewDocument["state"], Tone>> = {
  reading: "info",
  received: "success",
  needs_person: "warning",
  checked_by_person: "success",
  cannot_use: "danger",
  removed: "neutral",
  deleted_after_decision: "neutral",
  carried_over: "brand",
};

/** Documents that still count (not removed, not purged after the decision). */
export function activeDocuments(documents: readonly FamilyViewDocument[]): FamilyViewDocument[] {
  return documents.filter((d) => d.state !== "removed" && d.state !== "deleted_after_decision");
}

/**
 * The documents the server holds for this verification, each with its plain-language status. While the family can
 * still edit, each document can be removed (with a confirmation).
 */
export function DocumentList({ ctx, documents, returnTo, headingLevel = 2 }: { ctx: FlowContext; documents: readonly FamilyViewDocument[]; returnTo: Screen; headingLevel?: 2 | 3 }) {
  const t = ctx.t;
  const Heading = `h${headingLevel}` as "h2" | "h3";
  const shown = activeDocuments(documents);
  const fields = formFields(ctx);
  return (
    <section aria-labelledby="your-documents" className="space-y-3">
      <Heading id="your-documents" className="text-lg font-semibold text-fg">
        {t.upload.yourDocuments}
      </Heading>
      {shown.length === 0 ? (
        <p className="text-fg-muted">{t.upload.noDocuments}</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {shown.map((d) => (
            <li key={d.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="font-medium break-all text-fg">{d.filename}</p>
                <p className="text-sm text-fg-muted">{t.upload.kinds[d.declaredKind as keyof Dictionary["upload"]["kinds"]]?.label ?? t.upload.kinds.other_income.label}</p>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge tone={DOCUMENT_TONE[d.state]} className="text-left whitespace-normal!">{pickBilingual(d.label, ctx.locale)}</Badge>
                {ctx.state.canEdit && !d.carriedOver ? (
                  <ConfirmButton
                    label={
                      <>
                        {t.common.remove}
                        <span className="sr-only"> {d.filename}</span>
                      </>
                    }
                    variant="ghost"
                    triggerClassName="min-h-11"
                    tone="danger"
                    title={t.upload.removeTitle}
                    description={t.upload.removeBody}
                    confirmLabel={t.common.remove}
                    cancelLabel={t.common.cancel}
                    locale={ctx.locale}
                    action={removeDocumentAction}
                    fields={{ ...fields, documentId: d.id, screen: returnTo }}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The full name of a household member as the family typed it. */
export function memberName(m: { firstName: string; lastName: string }): string {
  return `${m.firstName} ${m.lastName}`.trim();
}
