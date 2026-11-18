import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Alert, Badge, Button, Card, Field, Input, Money, ProvisionalBadge, StatusBadge, TextLink } from "@/components/ui";
import { C, DoDont, Example, GUIDE_METADATA, GuideChrome, GuideSection, Row, Specimen } from "./_kit";

export const metadata: Metadata = { ...GUIDE_METADATA, title: "Style guide — Foundations" };

const TOC = [
  { id: "rules", label: "Rules of the kit" },
  { id: "audiences", label: "Three audiences" },
  { id: "color", label: "Colour" },
  { id: "type", label: "Typography" },
  { id: "space", label: "Spacing and density" },
  { id: "shape", label: "Radius, shadow, layers, motion" },
  { id: "a11y", label: "Accessibility baseline" },
];

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

const SCALES: Array<{ name: string; use: string }> = [
  { name: "ink", use: "Neutral. Text, borders, surfaces." },
  { name: "brand", use: "Petrol blue-green. Actions, links, selection, the header." },
  { name: "accent", use: "Marigold. The logo seal and the caution/provisional family. Sparingly." },
  { name: "success", use: "Yes, done, paid." },
  { name: "warning", use: "A person has to act." },
  { name: "danger", use: "No, failed, destructive." },
  { name: "info", use: "In progress, for your information." },
];

const ROLES: Array<{ token: string; utility: string; use: string; border?: boolean }> = [
  { token: "--canvas", utility: "bg-canvas", use: "Page background behind cards (dashboards, focus flows)." },
  { token: "--surface", utility: "bg-surface", use: "Cards, dialogs, inputs, marketing sections.", border: true },
  { token: "--sunken", utility: "bg-sunken", use: "Wells, hover fills, read-only fields." },
  { token: "--fg", utility: "text-fg", use: "Primary text." },
  { token: "--fg-muted", utility: "text-fg-muted", use: "Secondary text, labels of facts. 7:1 on white." },
  { token: "--fg-subtle", utility: "text-fg-subtle", use: "Captions and placeholders. 4.5:1 on white, canvas and sunken." },
  { token: "--line", utility: "border-line", use: "Dividers and card borders." },
  { token: "--line-strong", utility: "border-line-strong", use: "Borders that must read as an edge (secondary buttons, choice cards)." },
  { token: "--line-control", utility: "border-line-control", use: "Form-control boundary. 3:1 against white and canvas." },
  { token: "--action", utility: "bg-action", use: "Primary button, checked controls. With text-action-fg." },
  { token: "--link", utility: "text-link", use: "Links. Always underlined in running text." },
  { token: "--focus", utility: "outline-focus", use: "The focus ring. Global — never remove it." },
];

const TONES: Array<{ name: string; meaning: string; surface: string; solid: string }> = [
  { name: "neutral", meaning: "No judgement: counts, categories, closed states.", surface: "border-neutral-line bg-neutral-surface text-neutral-fg", solid: "bg-neutral-solid text-neutral-solid-fg" },
  { name: "brand", meaning: "Ours, selected, in hand.", surface: "border-brand-line bg-brand-surface text-brand-fg", solid: "bg-brand-solid text-brand-solid-fg" },
  { name: "info", meaning: "In progress. Nothing to do yet.", surface: "border-info-line bg-info-surface text-info-fg", solid: "bg-info-solid text-info-solid-fg" },
  { name: "success", meaning: "Yes, done, paid.", surface: "border-success-line bg-success-surface text-success-fg", solid: "bg-success-solid text-success-solid-fg" },
  { name: "warning", meaning: "A person must act.", surface: "border-warning-line bg-warning-surface text-warning-fg", solid: "bg-warning-solid text-warning-solid-fg" },
  { name: "danger", meaning: "No, failed, destructive.", surface: "border-danger-line bg-danger-surface text-danger-fg", solid: "bg-danger-solid text-danger-solid-fg" },
  { name: "caution", meaning: "Not final or not real: provisional limits, provisional lists, sandbox data. Dashed border + hatch.", surface: "hatch border-dashed border-caution-line bg-caution-surface text-caution-fg", solid: "bg-caution-solid text-caution-solid-fg" },
];

const TYPE_SAMPLES: Array<{ cls: string; name: string; spec: string; sample: string; display?: boolean }> = [
  { cls: "font-display text-display-xl", name: "text-display-xl", spec: "56 / 60 · serif", sample: "$312,000", display: true },
  { cls: "font-display text-display-lg", name: "text-display-lg", spec: "44 / 50 · serif", sample: "Give with the math in view", display: true },
  { cls: "font-display text-display-md", name: "text-display-md", spec: "36 / 42 · serif", sample: "How verification works", display: true },
  { cls: "font-display text-display-sm", name: "text-display-sm", spec: "28 / 34 · serif", sample: "Who lives in your home?", display: true },
  { cls: "text-2xl font-semibold tracking-tight", name: "text-2xl font-semibold", spec: "24 / 32 · dashboard page title", sample: "Verifications" },
  { cls: "text-lg font-semibold", name: "text-lg font-semibold", spec: "18 / 28 · section and card titles", sample: "Household and income" },
  { cls: "text-lg", name: "text-lg", spec: "18 / 28 · lead paragraphs", sample: "Confirm your household income once." },
  { cls: "text-base", name: "text-base", spec: "16 / 24 · body in family and donor flows", sample: "Upload a benefits award letter dated within the last 12 months." },
  { cls: "text-sm", name: "text-sm", spec: "14 / 20 · body in dashboards, hints, table cells", sample: "Submitted by Maria Alvarez · Harris County" },
  { cls: "text-xs font-semibold", name: "text-xs font-semibold", spec: "12 / 16 · table headers, captions (never body text)", sample: "Household size" },
  { cls: "font-mono text-[0.8125rem]", name: "font-mono", spec: "13 · ids, keys, code", sample: "ver_3Zk9QmT2 · ecca_test_3fK9…" },
];

function Swatch({ color, label, sub, border }: { color: string; label: string; sub?: string; border?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={border ? "h-12 rounded-control border border-line" : "h-12 rounded-control"} style={{ backgroundColor: color }} />
      <p className="mt-1.5 truncate font-mono text-xs text-fg">{label}</p>
      {sub ? <p className="truncate text-xs text-fg-muted">{sub}</p> : null}
    </div>
  );
}

function Audience({ title, who, children }: { title: string; who: string; children: ReactNode }) {
  return (
    <Card padding="none">
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <h3 className="text-lg font-semibold text-fg">{title}</h3>
        <p className="mt-1 text-sm text-fg-muted">{who}</p>
      </div>
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </Card>
  );
}

export default function StyleGuideFoundations() {
  return (
    <GuideChrome
      title="Foundations"
      lead={
        <p>
          The tokens and rules every screen is built from. Tokens live in <C>src/app/globals.css</C>; components in <C>src/components/ui</C>; shells in <C>src/components/layout</C>. This guide renders the real components, so what
          you see here is what ships.
        </p>
      }
      toc={TOC}
    >
      <GuideSection id="rules" title="Rules of the kit">
        <Card>
          <ol className="list-decimal space-y-3 pl-5 text-base text-fg marker:text-fg-subtle">
            <li>
              <strong className="font-semibold">Start from a shell.</strong> Every page renders inside <C>PublicShell</C>, <C>FocusShell</C>, <C>DashboardShell</C> or <C>EmbedShell</C>. The shell supplies the single{" "}
              <C>&lt;main id=&quot;main-content&quot;&gt;</C>, the density and the chrome.
            </li>
            <li>
              <strong className="font-semibold">Use role and tone utilities, not raw steps.</strong> <C>text-fg-muted</C>, <C>bg-surface</C>, <C>border-line</C>, <C>bg-success-surface</C>. Raw steps (<C>bg-brand-700</C>) are for the
              rare illustration. Tailwind’s own colour names (<C>gray</C>, <C>red</C>, <C>green</C>, <C>blue</C>…) are remapped onto this palette; purple, violet, indigo, fuchsia, pink and lime do not exist.
            </li>
            <li>
              <strong className="font-semibold">
                <C>className</C> on a kit component is for placement only
              </strong>{" "}
              — margin, width, grid or flex position. There is no class-conflict resolution, so do not try to recolour or re-pad a component through it. If a variant is missing, add it to the kit.
            </li>
            <li>
              <strong className="font-semibold">A status is always a StatusBadge.</strong> It owns the wording, colour and icon of every status in the data model. Never hand-write “Eligible” in a green pill.
            </li>
            <li>
              <strong className="font-semibold">Provisional things say so.</strong> Any income limit or decision that comes from the HUD-derived table, and the curated SGO list, carry <C>ProvisionalBadge</C> and, where there is room,{" "}
              <C>ProvisionalNotice</C>. Dashed border plus hatch means “not final or not real” and nothing else.
            </li>
            <li>
              <strong className="font-semibold">Money is integer cents.</strong> Show it with <C>Money</C>, collect it with <C>MoneyInput</C>, list it with <C>LineItems</C>. A fee is always its own line.
            </li>
            <li>
              <strong className="font-semibold">Server components by default.</strong> Most of the kit has no <C>&quot;use client&quot;</C>. Interactive pieces (Dialog, Tabs, MoneyInput, DateInput, OtpInput, FileDropzone, Toast, Tooltip,
              CopyButton, DropdownMenu, FormError, SubmitButton) are client components you can render straight from a server page.
            </li>
            <li>
              <strong className="font-semibold">Icons are lucide-react elements</strong> passed as props (<C>{"leadingIcon={<Upload />}"}</C>). They are decorative: the text next to them carries the meaning. No emoji as icons.
            </li>
          </ol>
        </Card>
      </GuideSection>

      <GuideSection
        id="audiences"
        title="Three audiences"
        lead="Three very different people use this product. The components are shared; the density, tone and type scale are not."
      >
        <Audience title="Families" who="A parent applying for a scholarship — often on a phone, sometimes in Spanish, possibly standing at a camp’s checkout. Shell: FocusShell or EmbedShell (touch density).">
          <DoDont
            dos={[
              "One question or one decision per screen, with one primary button (size lg, full width on phones).",
              "Plain words at a sixth-grade reading level: “your home”, “money you earned”, not “household composition” or “AGI”.",
              "Pass locale to every kit component and take page copy from src/i18n. Offer the LanguageToggle on every step.",
              "Say what happens next and what a result does and does not mean (“This is not an award”).",
              "Use Fieldset + DateInput for dates of birth and RadioGroup cards for choices with consequences.",
              "When something fails, say what to do instead (“Connecting didn’t work. You can upload a document instead.”).",
            ]}
            donts={[
              "Don’t show tables, dense key/value grids or dashboards jargon (status codes, ids).",
              "Don’t use red for “not eligible” on a family screen as if they had made an error. State it calmly with an Alert tone=\"neutral\" or \"info\".",
              "Don’t rely on tooltips: they do not exist on touch. Use DefinitionTooltip (tap) or visible hint text.",
              "Don’t hide the provisional label, the consent text or who receives the data behind a disclosure.",
              "Don’t mention fees to a family. Families never pay.",
            ]}
          />
        </Audience>
        <Audience title="Donors" who="An individual making a gift of up to $1,700 who must trust the arithmetic. Shell: FocusShell with the `aside` slot for the tax-math panel.">
          <DoDont
            dos={[
              "Lead with the numbers: Money variant=\"display\" for the gift, LineItems for every line, tabular figures everywhere.",
              "Keep the designated contribution and any fee on separate lines, always.",
              "Put the qualifiers next to the claim: nonrefundable, limited by your federal income tax, up to the cap.",
              "Mark anything from the proposed regulations “under the proposed rules”, and the SGO list as provisional.",
              "Use LegalNote for “preview, not tax advice” — visible, calm, never collapsed.",
            ]}
            donts={[
              "Don’t write tax sentences in a component. All tax copy comes from src/taxmath/copy.",
              "Don’t call a gift “free”, and don’t estimate the donor’s tax liability.",
              "Don’t decorate: no gradients, confetti, countdowns or urgency.",
              "Don’t take a credit-eligible gift before the credit start date; sandbox gifts are marked with Banner tone=\"sandbox\".",
            ]}
          />
        </Audience>
        <Audience title="Staff" who="Scholarship-organization reviewers, camp and school staff, platform admins — at a desk, working a queue. Shell: DashboardShell (default density).">
          <DoDont
            dos={[
              "Be dense and scannable: Table density=\"compact\", size=\"sm\" buttons, text-sm body, StatusBadge in every row.",
              "Keep the list in view: open one record in a Drawer driven by the URL (?detail=…).",
              "Put sort, filter and page in the URL so views can be shared and the page stays a server component.",
              "Always pass `mode` to DashboardShell; test data shows the hatched rule and the “Test mode” badge.",
              "Confirm destructive actions with ConfirmButton and a verb (“Revoke key”), and record them in the audit log.",
            ]}
            donts={[
              "Don’t use display type or size=\"lg\" controls in dashboards.",
              "Don’t show an eligible/not-eligible result without its `provisional` flag while the table is HUD-derived.",
              "Don’t invent a status colour. If a status is missing from StatusBadge, add it to status-map.ts.",
              "Don’t put a required decision in a toast. Toasts only confirm what already happened.",
            ]}
          />
        </Audience>
      </GuideSection>

      <GuideSection id="color" title="Colour" lead="One deep primary, one warm accent used sparingly, a neutral scale with real contrast, and a tone for each meaning. Light theme is the product; roles are indirected so a dark theme only has to redefine them.">
        <Specimen id="color-roles" name="Roles" importLine="utilities: bg-canvas, text-fg-muted, border-line …" note="What a colour is for. Components use roles; a role can be re-pointed (inverse surfaces, a future dark theme) without touching components.">
          <Example label="Role tokens">
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
              {ROLES.map((role) => (
                <Swatch key={role.token} color={`var(${role.token})`} label={role.utility} sub={role.use} border={role.border} />
              ))}
            </div>
          </Example>
          <Example label={'Inverse surface — data-surface="inverse" re-points the roles (text, links, Logo and Button only)'} surface="inverse">
            <Row>
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <TextLink href="/styleguide">A text link</TextLink>
              <span className="text-sm text-fg-muted">Muted text</span>
            </Row>
          </Example>
        </Specimen>

        <Specimen id="color-tones" name="Tones" importLine="utilities: bg-{tone}-surface · border-{tone}-line · text-{tone}-fg · bg-{tone}-solid · text-{tone}-solid-fg" note="One quartet per meaning. Pick the tone by what the thing MEANS, never by which colour looks nice.">
          <Example label="Soft (surface + line + fg) and solid">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {TONES.map((tone) => (
                <div key={tone.name} className={`rounded-card border p-4 ${tone.surface}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-sm font-semibold">{tone.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone.solid}`}>solid</span>
                  </div>
                  <p className="mt-1 text-sm">{tone.meaning}</p>
                </div>
              ))}
            </div>
          </Example>
        </Specimen>

        <Specimen id="color-scales" name="Raw scales" importLine="utilities: bg-ink-100 … text-brand-700 …" note="Eleven steps each (50–950). Reach for these only for illustration and data visualisation; UI uses roles and tones.">
          {SCALES.map((scale) => (
            <Example key={scale.name} label={`${scale.name} — ${scale.use}`}>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-11">
                {STEPS.map((step) => (
                  <Swatch key={step} color={`var(--color-${scale.name}-${step})`} label={String(step)} border={step <= 100} />
                ))}
              </div>
            </Example>
          ))}
        </Specimen>
      </GuideSection>

      <GuideSection id="type" title="Typography" lead="A system stack on purpose: nothing is downloaded, pages paint immediately, and the interface feels native. Serif display for big headings and the dollar figures people care about; sans for everything else.">
        <Specimen id="type-scale" name="Type scale" importLine="utilities: font-display text-display-md · text-base · text-sm …" note="Display sizes are for one headline or one figure per view. Dashboards use text-2xl semibold for page titles and text-sm for body.">
          <Example label="Scale">
            <div className="divide-y divide-line">
              {TYPE_SAMPLES.map((sample) => (
                <div key={sample.name} className="grid gap-x-6 gap-y-1 py-4 md:grid-cols-[16rem_minmax(0,1fr)] md:items-baseline">
                  <div>
                    <p className="font-mono text-xs text-fg">{sample.name}</p>
                    <p className="text-xs text-fg-muted">{sample.spec}</p>
                  </div>
                  <p className={`min-w-0 text-fg ${sample.cls} ${sample.display ? "truncate" : ""}`}>{sample.sample}</p>
                </div>
              ))}
            </div>
          </Example>
          <Example label="Numbers — the `nums` utility (tabular, lining figures). Money and DateTime apply it for you.">
            <div className="grid max-w-md grid-cols-2 gap-x-8 text-right text-base">
              <div>
                <p className="mb-1 text-left text-xs font-semibold text-fg-muted">With nums</p>
                <p className="nums">$1,700.00</p>
                <p className="nums">$312,000.00</p>
                <p className="nums">$11.10</p>
              </div>
              <div>
                <p className="mb-1 text-left text-xs font-semibold text-fg-muted">Money component</p>
                <p>
                  <Money cents={170_000} showCents />
                </p>
                <p>
                  <Money cents={31_200_000} showCents />
                </p>
                <p>
                  <Money cents={1_110} showCents />
                </p>
              </div>
            </div>
          </Example>
          <Example label="Font stacks">
            <dl className="grid gap-4 text-sm md:grid-cols-3">
              <div>
                <dt className="font-semibold text-fg">font-sans (default)</dt>
                <dd className="mt-1 text-fg-muted">Inter if installed, then the system UI font (San Francisco, Segoe UI, Roboto).</dd>
              </div>
              <div>
                <dt className="font-semibold text-fg">font-display</dt>
                <dd className="mt-1 font-display text-base text-fg-muted">Iowan Old Style, Palatino, Charter, Cambria, Georgia, Noto Serif.</dd>
              </div>
              <div>
                <dt className="font-semibold text-fg">font-mono</dt>
                <dd className="mt-1 font-mono text-fg-muted">ui-monospace, SF Mono, Cascadia Mono, Roboto Mono, Menlo, Consolas.</dd>
              </div>
            </dl>
          </Example>
        </Specimen>
      </GuideSection>

      <GuideSection id="space" title="Spacing and density" lead="An 8px grid: use even Tailwind steps (2, 4, 6, 8, 10, 12, 16 → 8, 16, 24, 32, 40, 48, 64px). 4px steps are for the inside of small components only.">
        <Specimen id="density" name="Density" importLine={'data-density="touch" (set by FocusShell and EmbedShell)'} note="Control heights are tokens. Family flows are 'touch' density: every control is at least 44px tall and text is 16px. On any coarse pointer (phones, tablets) small controls grow to 44px on their own.">
          <Example label="Default density — dashboards (sm 32px · md 40px · lg 48px)">
            <div className="grid max-w-xl gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Field label="Applicant email">
                <Input type="email" defaultValue="maria.alvarez@example.com" />
              </Field>
              <Row>
                <Button size="sm">Small</Button>
                <Button>Medium</Button>
                <Button size="lg">Large</Button>
              </Row>
            </div>
          </Example>
          <Example label={'Touch density — family and donor flows (data-density="touch": sm 44px · md 48px · lg 52px)'}>
            <div data-density="touch" className="grid max-w-xl gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Field label="Your email">
                <Input type="email" defaultValue="maria.alvarez@example.com" />
              </Field>
              <Row>
                <Button size="sm">Small</Button>
                <Button>Medium</Button>
                <Button size="lg">Large</Button>
              </Row>
            </div>
          </Example>
          <Example label="Layout widths">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="font-mono text-xs text-fg">max-w-focus · 34rem</dt>
                <dd className="text-fg-muted">The single-task card (FocusShell width=&quot;md&quot;).</dd>
              </div>
              <div>
                <dt className="font-mono text-xs text-fg">max-w-reading · 44rem</dt>
                <dd className="text-fg-muted">Running text: consent copy, descriptions, docs.</dd>
              </div>
              <div>
                <dt className="font-mono text-xs text-fg">max-w-page · 76rem</dt>
                <dd className="text-fg-muted">Marketing sections and dashboard content.</dd>
              </div>
            </dl>
          </Example>
        </Specimen>
      </GuideSection>

      <GuideSection id="shape" title="Radius, shadow, layers, motion">
        <Specimen id="radius-shadow" name="Radius and shadow" importLine="utilities: rounded-control · rounded-card · rounded-panel · shadow-xs … shadow-lg" note="Borders carry the structure. Shadows only lift things that float above the page (menus, dialogs, toasts) or respond to hover.">
          <Example label="Radius" surface="canvas">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { cls: "rounded-control", name: "rounded-control", use: "8px · buttons, inputs" },
                { cls: "rounded-card", name: "rounded-card", use: "12px · cards, alerts" },
                { cls: "rounded-panel", name: "rounded-panel", use: "16px · dialogs, feature panels" },
                { cls: "rounded-full", name: "rounded-full", use: "badges, avatars" },
              ].map((r) => (
                <div key={r.name}>
                  <div className={`h-16 border border-line-strong bg-surface ${r.cls}`} />
                  <p className="mt-1.5 font-mono text-xs text-fg">{r.name}</p>
                  <p className="text-xs text-fg-muted">{r.use}</p>
                </div>
              ))}
            </div>
          </Example>
          <Example label="Shadow" surface="canvas">
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              {[
                { cls: "shadow-xs", name: "shadow-xs", use: "buttons, inputs" },
                { cls: "shadow-sm", name: "shadow-sm", use: "the focus card" },
                { cls: "shadow-md", name: "shadow-md", use: "menus, hover lift" },
                { cls: "shadow-lg", name: "shadow-lg", use: "dialogs, toasts" },
              ].map((s) => (
                <div key={s.name}>
                  <div className={`h-16 rounded-card bg-surface ${s.cls}`} />
                  <p className="mt-2 font-mono text-xs text-fg">{s.name}</p>
                  <p className="text-xs text-fg-muted">{s.use}</p>
                </div>
              ))}
            </div>
          </Example>
          <Example label="Layers and motion">
            <dl className="grid gap-4 text-sm md:grid-cols-2">
              <div>
                <dt className="font-semibold text-fg">z-index utilities</dt>
                <dd className="mt-1 text-fg-muted">
                  <C>z-raised</C> (10) · <C>z-sticky</C> (100, sticky bars) · <C>z-nav</C> (200, site header and its menu) · <C>z-overlay</C> (300) · <C>z-toast</C> (400). Dialogs, drawers, menus and tooltips use the browser’s top
                  layer and need no z-index. Never write a raw <C>z-50</C>.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-fg">Motion</dt>
                <dd className="mt-1 text-fg-muted">
                  Transitions are 150ms on <C>ease-standard</C>; entrances use <C>animate-fade-in</C> / <C>animate-rise-in</C>. Motion only explains a change of state. With <C>prefers-reduced-motion</C> everything is instant
                  and spinners fade instead of rotating.
                </dd>
              </div>
            </dl>
          </Example>
        </Specimen>
      </GuideSection>

      <GuideSection id="a11y" title="Accessibility baseline" lead="WCAG 2.2 AA is the floor, not a feature.">
        <Card>
          <ul className="list-disc space-y-2 pl-5 text-base text-fg marker:text-fg-subtle">
            <li>
              <strong className="font-semibold">Contrast.</strong> Text tokens are at least 4.5:1 on every surface they are meant for (<C>fg</C> 17:1, <C>fg-muted</C> 7:1, <C>fg-subtle</C> 4.7:1 on sunken). Form-control borders and the
              focus ring are at least 3:1.
            </li>
            <li>
              <strong className="font-semibold">Focus.</strong> One global ring (<C>outline: 2px solid var(--focus)</C>, 2px offset) on everything focusable. Composite controls (choice cards, the dropzone) move it to their frame; nothing
              removes it.
            </li>
            <li>
              <strong className="font-semibold">Keyboard.</strong> Everything works with Tab, Shift+Tab, Enter, Space and Esc. Dialogs trap and return focus natively. The first Tab stop on every page is “Skip to main content”.
            </li>
            <li>
              <strong className="font-semibold">Targets.</strong> 44px minimum in touch density and on coarse pointers; 24px minimum everywhere.
            </li>
            <li>
              <strong className="font-semibold">Names.</strong> Every input sits in a <C>Field</C> or <C>Fieldset</C>; <C>IconButton</C> requires a <C>label</C>; decorative icons are <C>aria-hidden</C>; colour is never the only signal —
              every status has words and an icon.
            </li>
            <li>
              <strong className="font-semibold">Language.</strong> Family-facing components take <C>locale</C> (<C>&quot;en&quot;</C> | <C>&quot;es&quot;</C>); shells mark their content with <C>lang</C>.
            </li>
          </ul>
          <Alert tone="neutral" className="mt-5" title="How status, provisional and money look together">
            <Row className="mt-1">
              <StatusBadge kind="verification" status="eligible" provisional />
              <span className="text-fg">
                Limit used <Money cents={31_200_000} />
              </span>
              <ProvisionalBadge size="sm" />
              <Badge tone="neutral" variant="outline">
                Household of 4
              </Badge>
            </Row>
          </Alert>
        </Card>
      </GuideSection>
    </GuideChrome>
  );
}
