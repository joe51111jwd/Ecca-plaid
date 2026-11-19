/**
 * The one entry point the family-flow pages call. It loads the flow through ./server/context, decides from the
 * server's state which screen may be shown (never from anything the browser says), redirects otherwise, and frames
 * the screen in the page or embed shell with progress and a back link.
 */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getDictionary } from "@/i18n";
import { emailAddressSchema } from "@/server/auth";
import { FlowShell } from "../components/flow-shell";
import { isFamilyToken, isVerificationId, previousScreen, resolveScreen, screenHref, stepperStepOf, type FlowAddress, type Screen } from "../flow";
import { firstParam, loadFlow, resolveLocale, type FlowContext, type SearchParams } from "../server/context";
import { ReviewScreen, StatusScreen } from "./finish";
import { LandingScreen, LinkStateScreen, SignedOutScreen } from "./landing";
import { ConnectScreen, StatementScreen, UploadScreen } from "./proof";
import { hrefFor } from "./shared";
import { AddressScreen, ConsentScreen, CountyScreen, CustodyScreen, PathScreen, PeopleScreen, ReuseScreen, type ScreenProps } from "./steps";

const SCREEN_COMPONENTS: Record<Screen, (props: ScreenProps) => ReactNode | Promise<ReactNode>> = {
  reuse: ReuseScreen,
  consent: ConsentScreen,
  address: AddressScreen,
  county: CountyScreen,
  people: PeopleScreen,
  custody: CustodyScreen,
  path: PathScreen,
  upload: UploadScreen,
  connect: ConnectScreen,
  statement: StatementScreen,
  review: ReviewScreen,
  status: StatusScreen,
};

/** Query keys a screen keeps in its own URL (so the language switch returns to the same sub-view). */
const KEPT_QUERY: Partial<Record<Screen, readonly string[]>> = {
  people: ["add", "edit"],
  statement: ["kind", "member"],
};

function currentPathOf(ctx: FlowContext, screen: Screen, query: SearchParams): string {
  const keep: Record<string, string | undefined> = {};
  for (const key of KEPT_QUERY[screen] ?? []) keep[key] = firstParam(query[key]);
  return screenHref(ctx.base, screen, keep);
}

function langQuery(locale: "en" | "es"): string {
  return locale === "es" ? "?lang=es" : "";
}

/**
 * Renders a family-flow URL: the landing page when `requested` is null, otherwise the requested screen if the
 * server's state allows it (else a redirect to the screen the family should be on).
 */
export async function renderFlow(address: FlowAddress, requested: string | null, query: SearchParams): Promise<ReactNode> {
  const load = await loadFlow(address, query);

  if (load.kind === "not_found") notFound();
  if (load.kind === "signed_out") {
    if (requested) redirect(`${load.base}${langQuery(load.locale)}`);
    return <SignedOutScreen locale={load.locale} base={load.base} />;
  }
  if (load.kind === "link") {
    if (requested) redirect(`${load.base}${langQuery(load.locale)}`);
    return <LinkStateScreen link={load.link} locale={load.locale} surface={load.surface} base={load.base} />;
  }
  if (load.kind === "landing") {
    if (requested) redirect(`${load.base}${langQuery(load.locale)}`);
    const email = emailAddressSchema.safeParse(firstParam(query.email) ?? "");
    return <LandingScreen link={load.link} locale={load.locale} surface={load.surface} base={load.base} user={load.user} defaultEmail={email.success ? email.data : ""} />;
  }

  const ctx = load.ctx;
  const decision = resolveScreen(requested, ctx.state);
  if (decision.redirect) {
    // Keep a notice that belongs to the screen the family is sent to (for example after reusing failed).
    const notice = firstParam(query.notice);
    redirect(hrefFor(ctx, decision.screen, notice ? { notice } : {}));
  }
  const screen = decision.screen;
  const Screen = SCREEN_COMPONENTS[screen];
  const prev = previousScreen(screen, ctx.state);
  return (
    <FlowShell
      surface={ctx.surface}
      locale={ctx.locale}
      currentPath={currentPathOf(ctx, screen, query)}
      orgName={ctx.view.orgName}
      sandbox={ctx.view.sandbox}
      step={stepperStepOf(screen)}
      back={prev ? hrefFor(ctx, prev) : null}
      showExit={screen !== "status"}
      width={screen === "upload" || screen === "review" ? "lg" : "md"}
    >
      <Screen ctx={ctx} query={query} />
    </FlowShell>
  );
}

/** Page metadata for the flow (no indexing; the title in the family's language). */
export async function flowMetadata(query: SearchParams): Promise<Metadata> {
  const t = getDictionary(await resolveLocale(query));
  return { title: t.meta.linkTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** A verification-link URL (`/v/{token}[/{screen}]` or the embed twin). A malformed token shows the "cannot find this link" page. */
export async function renderTokenFlow(surface: "page" | "embed", token: string, screen: string | null, query: SearchParams): Promise<ReactNode> {
  if (!isFamilyToken(token)) {
    if (screen) notFound();
    const locale = await resolveLocale(query);
    return <LinkStateScreen link={{ state: "invalid" }} locale={locale} surface={surface} base={surface === "embed" ? "/embed/verify" : "/v"} />;
  }
  return renderFlow({ kind: "token", token, surface }, screen, query);
}

/** A verification opened by id from the household page (`/family/verifications/{id}[/{screen}]`). */
export async function renderIdFlow(verificationId: string, screen: string | null, query: SearchParams): Promise<ReactNode> {
  if (!isVerificationId(verificationId)) notFound();
  return renderFlow({ kind: "id", verificationId }, screen, query);
}
