import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { Button, CodeBlock, KeyValue, KeyValueList } from "@/components/ui";
import { C, Example, GUIDE_METADATA, GuideChrome, GuideSection, Specimen } from "../_kit";

export const metadata: Metadata = { ...GUIDE_METADATA, title: "Style guide — Shells" };

const TOC = [
  { id: "public-shell", label: "PublicShell" },
  { id: "focus-shell", label: "FocusShell" },
  { id: "dashboard-shell", label: "DashboardShell" },
  { id: "embed-shell", label: "EmbedShell" },
  { id: "system-page", label: "SystemPage" },
];

const FOCUS_SAMPLE = `import { FocusShell } from "@/components/layout";
import { LanguageToggle, Stepper } from "@/components/ui";

export default async function Step() {
  // 1. guard  2. load  3. render
  return (
    <FocusShell
      locale={locale}
      partner={{ name: sgo.displayName, logoUrl: sgo.logoUrl }}
      languageToggle={<LanguageToggle current={locale} hrefs={{ en: enHref, es: esHref }} />}
      progress={<Stepper steps={steps} current="household" locale={locale} />}
      back={{ href: previousStepHref }}
    >
      <h1 className="font-display text-display-sm text-fg">{t.title}</h1>
      {/* one question, one primary button */}
    </FocusShell>
  );
}`;

const DASHBOARD_SAMPLE = `import { Inbox, KeyRound, LayoutDashboard } from "lucide-react";
import { DashboardShell, OrgSwitcher, UserMenu } from "@/components/layout";

// app/sgo/layout.tsx — configure once per app (SGO, business, admin)
<DashboardShell
  appLabel="Scholarship organization"
  homeHref="/sgo"
  mode={mode}                                   // "test" | "live" — always pass it
  nav={[
    { items: [
      { href: "/sgo", label: "Overview", icon: <LayoutDashboard />, match: "exact" },
      { href: "/sgo/verifications", label: "Verifications", icon: <Inbox />, count: openReviews },
    ] },
    { title: "Developers", items: [{ href: "/sgo/settings/api-keys", label: "API keys", icon: <KeyRound /> }] },
  ]}
  orgSwitcher={<OrgSwitcher current={org} orgs={orgs} />}
  userMenu={<UserMenu name={user.name} email={user.email} signOutAction={signOut} />}
>
  {children}
</DashboardShell>`;

const EMBED_SAMPLE = `import { EmbedShell } from "@/components/layout";

// app/embed/handoff/page.tsx
<EmbedShell partner={{ name: business.displayName, logoUrl: business.logoUrl }} targetOrigin={allowedOrigin} locale={locale}>
  …
</EmbedShell>

// On the partner's page (their embed script):
window.addEventListener("message", (event) => {
  if (event.origin !== APP_ORIGIN) return;
  if (event.data?.source !== "ecca-embed" || event.data.type !== "resize") return;
  iframe.style.height = event.data.height + "px";
});`;

function Demo({ href, children }: { href: string; children: string }) {
  return (
    <Button href={href} variant="secondary" trailingIcon={<ArrowRight />}>
      {children}
    </Button>
  );
}

export default function StyleGuideShells() {
  return (
    <GuideChrome
      title="Shells"
      lead={
        <p>
          Every page starts from one of four shells. Import from <C>@/components/layout</C>. Each renders the page’s single <C>&lt;main id=&quot;main-content&quot;&gt;</C> (the skip link’s target), so never add another{" "}
          <C>&lt;main&gt;</C> inside. The live demos below are full pages built only from the kit — read their source as templates.
        </p>
      }
      toc={TOC}
    >
      <GuideSection id="shells" title="The four shells">
        <Specimen id="public-shell" name="PublicShell" importLine='import { PublicShell } from "@/components/layout"' note={<p>Marketing chrome: sticky header with the public navigation, footer with the standing legal notes. For the landing page and other public, read-only pages.</p>}>
          <Example label="Slots and demo">
            <div className="space-y-4">
              <KeyValueList dense className="max-w-3xl">
                <KeyValue label="nav">Header links. Defaults to the five public entry points (PUBLIC_NAV).</KeyValue>
                <KeyValue label="actions">Buttons at the end of the header (a sign-in link).</KeyValue>
                <KeyValue label="banner">A Banner above the header.</KeyValue>
                <KeyValue label="footerNote">Extra legal text above the standing notes.</KeyValue>
              </KeyValueList>
              <Demo href="/">Open the landing page</Demo>
            </div>
          </Example>
        </Specimen>

        <Specimen
          id="focus-shell"
          name="FocusShell"
          importLine='import { FocusShell } from "@/components/layout"'
          note={
            <p>
              The single-task shell: sign-in, every family intake step, donor checkout. One calm column and one card. It sets <C>data-density=&quot;touch&quot;</C> (every control at least 44px) and <C>lang</C> from <C>locale</C>.
            </p>
          }
        >
          <Example label="Slots and demos">
            <div className="space-y-4">
              <KeyValueList dense className="max-w-3xl">
                <KeyValue label="partner">Co-branding beside the logo: the scholarship organization or the camp the person came through.</KeyValue>
                <KeyValue label="languageToggle">A LanguageToggle.</KeyValue>
                <KeyValue label="progress">A Stepper above the card.</KeyValue>
                <KeyValue label="back · exit">Previous step; a quiet link in the header (“Save and finish later”).</KeyValue>
                <KeyValue label="aside">Second column on wide screens — the donor tax-math panel. Stacks under the card on phones.</KeyValue>
                <KeyValue label="width · card">sm sign-in, md one question (default), lg/xl summaries; card=false to bring your own cards.</KeyValue>
                <KeyValue label="secureNote · footer">The reassurance line: &quot;family&quot;, &quot;donor&quot;, your own text or false; and small links under it.</KeyValue>
                <KeyValue label="banner · homeHref">Sandbox Banner; logo link (null inside flows people should not wander out of).</KeyValue>
              </KeyValueList>
              <div className="flex flex-wrap gap-3">
                <Demo href="/styleguide/shells/focus">Family step (English)</Demo>
                <Demo href="/styleguide/shells/focus?lang=es">Family step (Español)</Demo>
                <Demo href="/styleguide/shells/checkout">Donor checkout with aside</Demo>
              </div>
            </div>
          </Example>
          <Example label="Typical use">
            <CodeBlock code={FOCUS_SAMPLE} language="tsx" tone="light" />
          </Example>
        </Specimen>

        <Specimen
          id="dashboard-shell"
          name="DashboardShell · OrgSwitcher · UserMenu"
          importLine='import { DashboardShell, OrgSwitcher, UserMenu } from "@/components/layout"'
          note={
            <p>
              The staff shell: sidebar and top bar on desktop, a menu drawer below 1024px. The sidebar is data (<C>nav</C>), so the SGO, business and admin apps configure the same shell. Nav icons are lucide <em>elements</em> (
              <C>{"<Inbox />"}</C>). In test mode a hatched rule runs under the top bar.
            </p>
          }
        >
          <Example label="Slots and demo">
            <div className="space-y-4">
              <KeyValueList dense className="max-w-3xl">
                <KeyValue label="nav · appLabel">Sections of links with icon, count and match; the name of the app under the logo.</KeyValue>
                <KeyValue label="orgSwitcher">Top of the sidebar: an OrgSwitcher (a plain label when the person has one organization).</KeyValue>
                <KeyValue label="userMenu">End of the top bar: a UserMenu with a sign-out server action.</KeyValue>
                <KeyValue label="mode · modeControl">“Test mode” / “Live” badge, or your own switch in its place.</KeyValue>
                <KeyValue label="topBar · banner · sidebarFooter">Search or breadcrumbs; a Banner; docs and help links.</KeyValue>
                <KeyValue label="width">default (76rem), narrow (settings forms), full (very wide tables).</KeyValue>
              </KeyValueList>
              <div className="flex flex-wrap gap-3">
                <Demo href="/styleguide/shells/dashboard">Verification queue</Demo>
                <Demo href="/styleguide/shells/dashboard?detail=ver_3Zk9QmT2">Queue with a URL-driven drawer</Demo>
              </div>
            </div>
          </Example>
          <Example label="Typical use">
            <CodeBlock code={DASHBOARD_SAMPLE} language="tsx" tone="light" />
          </Example>
        </Specimen>

        <Specimen
          id="embed-shell"
          name="EmbedShell · useEmbedAutoHeight"
          importLine='import { EmbedShell, useEmbedAutoHeight, EMBED_MESSAGE_SOURCE } from "@/components/layout"'
          note={
            <p>
              Chrome-less shell for pages inside a partner’s iframe (<C>/embed/…</C>): transparent page background, touch density, and it posts its height to the parent so the iframe can size itself. The message is{" "}
              <C>{'{ source: "ecca-embed", type: "resize", height }'}</C>. Only routes under <C>/embed/</C> may be framed (see next.config.ts).
            </p>
          }
        >
          <Example label="Slots and demo">
            <div className="space-y-4">
              <KeyValueList dense className="max-w-3xl">
                <KeyValue label="partner">The business whose page embeds this, shown in a slim header.</KeyValue>
                <KeyValue label="autoHeight · targetOrigin">Height reporting (default on) and the origin allowed to receive it (pass the business’s allowed origin).</KeyValue>
                <KeyValue label="languageToggle · locale · secureNote">As in FocusShell.</KeyValue>
              </KeyValueList>
              <Demo href="/styleguide/shells/embed">Handoff offer (as it appears in the iframe)</Demo>
            </div>
          </Example>
          <Example label="Typical use, and the listener on the partner’s page">
            <CodeBlock code={EMBED_SAMPLE} language="tsx" tone="light" />
          </Example>
        </Specimen>

        <Specimen id="system-page" name="SystemPage" importLine='import { SystemPage } from "@/components/layout"' note={<p>A full-page message in the system style: not found, something went wrong, link expired, signed out. The app’s 404 and error pages use it.</p>}>
          <Example label="Demo">
            <Demo href="/styleguide/this-page-does-not-exist">Open the 404 page</Demo>
          </Example>
        </Specimen>
      </GuideSection>
    </GuideChrome>
  );
}
