import { BookOpen, Eye, FileCheck, HandCoins, Inbox, KeyRound, LayoutDashboard, LifeBuoy, Plus, Search, Settings, UsersRound, Webhook } from "lucide-react";
import type { Metadata } from "next";
import { DashboardShell, OrgSwitcher, UserMenu } from "@/components/layout";
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardFooter,
  DateTime,
  Drawer,
  Field,
  Input,
  KeyValue,
  KeyValueList,
  Money,
  PageHeader,
  Pagination,
  ProvisionalNotice,
  Stat,
  StatGrid,
  StatusBadge,
  Table,
  Tabs,
  TextLink,
  Timeline,
  type TableColumn,
} from "@/components/ui";
import { demoConfirmAction } from "../../_actions";
import { SAMPLE_CAMP, SAMPLE_NOW, SAMPLE_SGO, SAMPLE_USER, SAMPLE_VERIFICATIONS, type SampleVerification } from "../../_data";
import { GUIDE_METADATA } from "../../_kit";

export const metadata: Metadata = { ...GUIDE_METADATA, title: "Shell demo — dashboard" };

const BASE = "/styleguide/shells/dashboard";

const COLUMNS: Array<TableColumn<SampleVerification>> = [
  {
    key: "applicant",
    header: "Applicant",
    primary: true,
    cell: (row) => (
      <span className="flex items-center gap-2.5">
        <Avatar name={row.applicant} size="sm" />
        <span>
          {row.applicant}
          <span className="block text-xs font-normal text-fg-muted">{row.externalRef}</span>
        </span>
      </span>
    ),
  },
  { key: "student", header: "Student", cell: (row) => row.student, hideWhenStacked: true },
  { key: "status", header: "Status", cell: (row) => <StatusBadge kind="verification" status={row.status} provisional={row.provisional && (row.status === "eligible" || row.status === "ineligible")} size="sm" /> },
  { key: "stage", header: "Stage", cell: (row) => <StatusBadge kind="stage" status={row.stage} size="sm" showIcon={false} /> },
  { key: "method", header: "Method", cell: (row) => (row.method ? <StatusBadge kind="method" status={row.method} size="sm" showIcon={false} /> : <span className="text-fg-subtle">—</span>) },
  { key: "thresholdCents", header: "Limit used", numeric: true, cell: (row) => <Money cents={row.thresholdCents} /> },
  { key: "updatedAt", header: "Updated", numeric: true, cell: (row) => <DateTime value={row.updatedAt} format="relative" now={SAMPLE_NOW} /> },
];

const FILTERS = {
  all: () => true,
  needs_review: (row: SampleVerification) => row.status === "needs_review",
  pending: (row: SampleVerification) => row.status === "pending",
  decided: (row: SampleVerification) => row.status === "eligible" || row.status === "ineligible",
} as const;

type FilterKey = keyof typeof FILTERS;

export default async function DashboardShellDemo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filter: FilterKey = typeof params.status === "string" && params.status in FILTERS ? (params.status as FilterKey) : "all";
  const rows = SAMPLE_VERIFICATIONS.filter(FILTERS[filter]);
  const listHref = filter === "all" ? BASE : `${BASE}?status=${filter}`;
  const detailId = typeof params.detail === "string" ? params.detail : null;
  const detail = detailId ? (SAMPLE_VERIFICATIONS.find((row) => row.id === detailId) ?? null) : null;
  const count = (key: FilterKey) => SAMPLE_VERIFICATIONS.filter(FILTERS[key]).length;
  const tabHref = (key: FilterKey) => (key === "all" ? BASE : `${BASE}?status=${key}`);

  return (
    <DashboardShell
      appLabel={SAMPLE_SGO.typeLabel}
      homeHref="/styleguide/shells"
      mode="test"
      nav={[
        {
          items: [
            { href: "/styleguide", label: "Overview", icon: <LayoutDashboard />, match: "exact" },
            { href: BASE, label: "Verifications", icon: <Inbox />, count: count("needs_review") },
            { href: "/styleguide/components", label: "Donations", icon: <HandCoins /> },
            { href: "/styleguide/forms", label: "Acknowledgments", icon: <FileCheck /> },
          ],
        },
        {
          title: "Settings",
          items: [
            { href: "/styleguide/shells", label: "Organization", icon: <Settings />, match: "exact" },
            { href: "/styleguide/shells/focus", label: "Team", icon: <UsersRound /> },
            { href: "/styleguide/shells/checkout", label: "API keys", icon: <KeyRound /> },
            { href: "/styleguide/shells/embed", label: "Webhooks", icon: <Webhook /> },
          ],
        },
      ]}
      orgSwitcher={
        <OrgSwitcher
          current={{ id: "org_sgo", name: SAMPLE_SGO.name, href: BASE, typeLabel: SAMPLE_SGO.typeLabel }}
          orgs={[
            { id: "org_sgo", name: SAMPLE_SGO.name, href: BASE, typeLabel: SAMPLE_SGO.typeLabel },
            { id: "org_camp", name: SAMPLE_CAMP.name, href: "/styleguide/shells", typeLabel: SAMPLE_CAMP.typeLabel },
          ]}
        />
      }
      userMenu={<UserMenu name={SAMPLE_USER.name} email={SAMPLE_USER.email} items={[{ label: "Your profile", href: "/styleguide/shells" }]} signOutAction={demoConfirmAction} />}
      topBar={
        <div className="hidden max-w-sm md:block">
          <Field label="Search applicants" hideLabel>
            <Input type="search" size="sm" name="q" placeholder="Search applicants or references" leading={<Search />} />
          </Field>
        </div>
      }
      sidebarFooter={
        <ul className="space-y-2">
          <li>
            <TextLink href="/docs" tone="quiet" className="inline-flex items-center gap-2">
              <BookOpen aria-hidden="true" className="size-4" /> API reference
            </TextLink>
          </li>
          <li>
            <TextLink href="/styleguide" tone="quiet" className="inline-flex items-center gap-2">
              <LifeBuoy aria-hidden="true" className="size-4" /> Help
            </TextLink>
          </li>
        </ul>
      }
    >
      <div className="space-y-6">
        <PageHeader
          title="Verifications"
          description="Every household you have asked to verify. Results are provisional while income limits are HUD-derived."
          actions={
            <Button size="sm" leadingIcon={<Plus />}>
              New verification
            </Button>
          }
        />

        <StatGrid columns={4} tiles>
          <Stat label="Needs review" value={String(count("needs_review"))} hint="Oldest: 39 minutes" />
          <Stat label="Pending with family" value={String(count("pending"))} />
          <Stat label="Decided" value={String(count("decided"))} hint="This month" />
          <Stat label="Median time to decision" value="1.4 days" />
        </StatGrid>

        <Card padding="none">
          <div className="border-b border-line px-5 sm:px-6">
            <Tabs
              divider={false}
              label="Filter verifications"
              current={tabHref(filter)}
              items={[
                { href: tabHref("all"), label: "All", count: count("all") },
                { href: tabHref("needs_review"), label: "Needs review", count: count("needs_review"), icon: <Eye /> },
                { href: tabHref("pending"), label: "Pending", count: count("pending") },
                { href: tabHref("decided"), label: "Decided", count: count("decided") },
              ]}
            />
          </div>
          <Table
            caption="Verifications"
            density="compact"
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `${listHref}${listHref.includes("?") ? "&" : "?"}detail=${row.id}`}
            selectedKey={detail?.id}
          />
          <CardFooter>
            <Pagination summary={`Showing ${rows.length} of ${SAMPLE_VERIFICATIONS.length}`} />
          </CardFooter>
        </Card>
      </div>

      {/* URL-driven detail pane: the server renders it open when ?detail= is present; closing navigates back to the list. */}
      <Drawer open={detail !== null} closeHref={listHref} size="md" title={detail?.applicant ?? ""} description={detail ? `${detail.externalRef} · ${detail.id}` : undefined}>
        {detail ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge kind="verification" status={detail.status} provisional={detail.provisional && (detail.status === "eligible" || detail.status === "ineligible")} />
              <StatusBadge kind="stage" status={detail.stage} size="sm" />
            </div>
            {detail.status === "needs_review" ? (
              <Alert tone="warning" title="Why this needs a person">
                <p>Household income is within 5% of the provisional limit.</p>
              </Alert>
            ) : null}
            <KeyValueList dense>
              <KeyValue label="Student">{detail.student}</KeyValue>
              <KeyValue label="Household">{detail.householdSize ? `${detail.householdSize} people · Harris County` : "—"}</KeyValue>
              <KeyValue label="Household income">
                <Money cents={detail.incomeCents} />
              </KeyValue>
              <KeyValue label="Limit used">
                <Money cents={detail.thresholdCents} />
              </KeyValue>
              <KeyValue label="Method">{detail.method ? <StatusBadge kind="method" status={detail.method} size="sm" /> : "—"}</KeyValue>
              <KeyValue label="Updated">
                <DateTime value={detail.updatedAt} format="dateTime" />
              </KeyValue>
            </KeyValueList>
            {detail.thresholdCents ? <ProvisionalNotice compact /> : null}
            <div>
              <h3 className="mb-3 text-sm font-semibold text-fg">History</h3>
              <Timeline
                label="Verification history"
                format="relative"
                now={SAMPLE_NOW}
                items={[
                  { id: "1", title: "Verification created", at: "2026-11-17T15:02:00Z", actor: "API key · Admissions system" },
                  { id: "2", title: "Family gave consent", at: "2026-11-17T23:40:00Z", actor: detail.applicant, tone: "info" },
                  { id: "3", title: "Last updated", at: detail.updatedAt, actor: "System" },
                ]}
              />
            </div>
          </div>
        ) : null}
      </Drawer>
    </DashboardShell>
  );
}
