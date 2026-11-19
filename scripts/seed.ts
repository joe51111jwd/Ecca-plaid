/**
 * Demo data for local development, demos and the recorded walkthrough.
 *
 *   npm run db:seed                         seeds the database ECCA_DATA_DIR / DATABASE_URL points at
 *   APP_URL=http://localhost:3217 ECCA_DATA_DIR=.data-demo npm run db:seed
 *
 * Everything goes through the services' public APIs (sign-in, SGO list import, organizations, households,
 * verifications, reviews, checkout, sandbox payments, handoffs): the seed exercises the same code paths as the app
 * and leaves the same audit trail. It is idempotent: organizations, keys and endpoints are found or created, and each
 * activity scenario is skipped when its record already exists (keyed by the SGO's external reference or the camp's
 * booking reference).
 *
 * With the embedded database (no DATABASE_URL) the dev server must be stopped while this runs: PGlite holds its files
 * for one process at a time.
 *
 * Every organization, person, address, document, amount and EIN here is SYNTHETIC. The two SGOs come from
 * data/sgo-list/provisional-sandbox.csv (fictional, 00- EINs the IRS does not assign); emails use the reserved
 * .test top-level domain so nothing can ever be delivered.
 */
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/* ------------------------------------------------------------------------------------------------ constants */

/** Reserved-TLD addresses used to sign in to the seeded demo (codes appear at /dev/mail). */
export const DEMO_LOGINS = Object.freeze({
  admin: "admin@passport.test",
  sgoOwner: "director@lonestar-fund.passport.test",
  sgoReviewer: "reviewer@lonestar-fund.passport.test",
  otherSgoOwner: "director@bluebonnet-partners.passport.test",
  campOwner: "director@camp-cedar-creek.example",
  donor: "donor@passport.test",
  jointDonor: "couple@passport.test",
});

/** The two sandbox SGOs, by their rows in data/sgo-list/provisional-sandbox.csv. */
export const DEMO_SGOS = Object.freeze({
  primary: { name: "Demo: Lone Star Scholarship Fund (sandbox)", ein: "00-1000001", city: "Austin" },
  other: { name: "Demo: Bluebonnet Education Partners (sandbox)", ein: "00-1000002", city: "Houston" },
});

/** The fictional camp. Its name matches the /demo/camp site (src/features/handoff/demo.ts) so that site uses it. */
export const DEMO_CAMP_NAME = "Camp Cedar Creek (demo)";

/**
 * Local port of the demo webhook listener. The seed (and scripts/record-demo.ts) listen here so that webhook
 * deliveries to the seeded endpoint succeed with a verified signature instead of piling up as retries.
 */
export const DEMO_WEBHOOK_PORT = 4789;
export const DEMO_WEBHOOK_PATH = "/passport-webhooks";

/** Where the seed writes the sandbox API key and webhook secret (inside the gitignored data directory). */
export const CREDENTIALS_FILE = "demo-credentials.json";

export interface DemoCredentials {
  appUrl: string;
  sgoOrgId: string;
  otherSgoOrgId: string;
  campOrgId: string;
  apiKey: string | null;
  webhookEndpointId: string;
  webhookUrl: string;
  webhookSecret: string | null;
  verifications: Record<ScenarioKey, string>;
  handoffBookingRef: string;
  /** The verification behind the held camp booking (in review until the SGO confirms the letter). */
  handoffVerificationId: string | null;
}

/** The verification scenarios, each keyed by the SGO's external reference. */
export const SCENARIOS = Object.freeze({
  snapEligible: "DEMO-SNAP-ELIGIBLE",
  w2Eligible: "DEMO-W2-ELIGIBLE",
  betweenReadings: "DEMO-BETWEEN-READINGS",
  unreadableScan: "DEMO-UNREADABLE-SCAN",
  awaitingFamily: "DEMO-AWAITING-FAMILY",
  ineligible: "DEMO-INELIGIBLE",
  otherSgo: "DEMO-OTHER-SGO",
});
export type ScenarioKey = keyof typeof SCENARIOS;

export const HANDOFF_BOOKING_REF = "CCC-DEMO-0001";

/** Who each synthetic household is and where it lives. ZIPs are chosen inside the named county. */
interface FamilyPlan {
  email: string;
  owner: { firstName: string; lastName: string };
  student: { firstName: string; lastName: string };
  extraAdult?: { firstName: string; lastName: string };
  address: { line1: string; city: string; zip: string };
  countyFips: string;
}

const FAMILIES: Record<Exclude<ScenarioKey, "otherSgo"> | "handoff", FamilyPlan> = {
  snapEligible: { email: "family.garcia@passport.test", owner: { firstName: "Lucia", lastName: "Sample" }, student: { firstName: "Mateo", lastName: "Sample" }, address: { line1: "100 Fixture Lane", city: "Houston", zip: "77002" }, countyFips: "48201" },
  w2Eligible: { email: "family.nguyen@passport.test", owner: { firstName: "Thanh", lastName: "Example" }, student: { firstName: "Bao", lastName: "Example" }, address: { line1: "200 Synthetic Street", city: "Austin", zip: "78701" }, countyFips: "48453" },
  // Starr County is where the two readings of the proposed rule are furthest apart in the provisional table.
  betweenReadings: { email: "family.ramos@passport.test", owner: { firstName: "Elena", lastName: "Placeholder" }, student: { firstName: "Diego", lastName: "Placeholder" }, address: { line1: "300 Demo Road", city: "Rio Grande City", zip: "78582" }, countyFips: "48427" },
  unreadableScan: { email: "family.okafor@passport.test", owner: { firstName: "Ada", lastName: "Testcase" }, student: { firstName: "Chidi", lastName: "Testcase" }, address: { line1: "400 Example Avenue", city: "Dallas", zip: "75201" }, countyFips: "48113" },
  awaitingFamily: { email: "family.patel@passport.test", owner: { firstName: "Priya", lastName: "Fixture" }, student: { firstName: "Arjun", lastName: "Fixture" }, extraAdult: { firstName: "Ravi", lastName: "Fixture" }, address: { line1: "500 Sample Court", city: "San Antonio", zip: "78205" }, countyFips: "48029" },
  ineligible: { email: "family.miller@passport.test", owner: { firstName: "Grace", lastName: "Mockdata" }, student: { firstName: "Owen", lastName: "Mockdata" }, address: { line1: "600 Fixture Boulevard", city: "Houston", zip: "77002" }, countyFips: "48201" },
  handoff: { email: "family.johnson@passport.test", owner: { firstName: "Tasha", lastName: "Demo" }, student: { firstName: "Kai", lastName: "Demo" }, address: { line1: "700 Camp Trail", city: "Austin", zip: "78701" }, countyFips: "48453" },
};

/** SYNTHETIC prior-year wages per scenario (box 1 of a 2025 W-2), in cents. */
const WAGES_CENTS = {
  w2Eligible: 5_840_000,
  // Starr County, household of two: above the median-product reading, below the Section 8 reading.
  betweenReadings: 15_000_000,
  awaitingFamily: 3_900_000,
  // Harris County, household of two: above both readings ($249,600).
  ineligible: 31_500_000,
} as const;

const REQUEST = { ip: "198.51.100.200", userAgent: "passport-seed" } as const;

/* ------------------------------------------------------------------------------------------------ helpers */

/** Same files Next.js reads for the app; variables already set in the environment win. */
function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
}

function log(line: string): void {
  console.log(`  ${line}`);
}

/**
 * pdfjs refuses to read documents while Array.prototype carries enumerable additions, and drizzle-kit (loaded by
 * the embedded database to create its schema) adds one. Same workaround as the services' own tests.
 */
function hideEnumerableArrayExtensions(): void {
  for (const key of Object.keys(Array.prototype)) Object.defineProperty(Array.prototype, key, { enumerable: false });
}

/** Starts the demo webhook listener; it accepts every delivery (the e2e and record scripts verify signatures). */
export function startDemoWebhookListener(port = DEMO_WEBHOOK_PORT): Promise<Server | null> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(req.url?.startsWith(DEMO_WEBHOOK_PATH) ? 200 : 404, { "content-type": "application/json" });
        res.end('{"received":true}');
      });
    });
    server.once("error", () => resolve(null));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/* ------------------------------------------------------------------------------------------------ the seed */

export interface SeedOptions {
  /** Where the demo credentials file goes; default ECCA_DATA_DIR. */
  dataDir?: string;
  /** Print progress. Default true. */
  verbose?: boolean;
  /** Start the local webhook listener during the run. Default true. */
  listen?: boolean;
}

export interface SeedResult {
  credentials: DemoCredentials;
  created: string[];
  skipped: string[];
}

export async function seedDemo(opts: SeedOptions = {}): Promise<SeedResult> {
  const say = opts.verbose === false ? () => {} : log;
  // Platform admins are granted on first sign-in from PLATFORM_ADMIN_EMAILS; the seed signs the admin in once.
  const admins = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.includes(DEMO_LOGINS.admin)) process.env.PLATFORM_ADMIN_EMAILS = [...admins, DEMO_LOGINS.admin].join(",");

  const [{ getDb }, { env, appUrl, isProd }, { generateSyntheticDocument }] = await Promise.all([import("@/db/client"), import("@/lib/env"), import("@/engine/documents/synthetic")]);
  if (isProd()) throw new Error("The demo seed never runs in production.");
  await getDb();
  hideEnumerableArrayExtensions();

  const auth = await import("@/server/auth");
  const email = await import("@/server/email");
  const orgs = await import("@/server/orgs");
  const sgos = await import("@/server/sgos");
  const api = await import("@/server/api");
  const webhooks = await import("@/server/webhooks");
  const businesses = await import("@/server/businesses");
  const households = await import("@/server/households");
  const verifications = await import("@/server/verifications");
  const donations = await import("@/server/donations");
  const payments = await import("@/server/payments");
  const handoffs = await import("@/server/handoffs");
  const jobs = await import("@/server/jobs");
  const registry = await import("@/server/jobs/registry");

  const created: string[] = [];
  const skipped: string[] = [];
  const sys = sgos.systemActor("demo seed (synthetic data)");
  const bizSys = businesses.businessSystemActor("demo seed (synthetic data)");
  const listener = opts.listen === false ? null : await startDemoWebhookListener();

  /** Runs every due job with the app's handlers; waits briefly for jobs that were deferred a few seconds. */
  async function drain(idleBudgetMs = 3_000): Promise<void> {
    const handlers = registry.allJobHandlers();
    let idleSince: number | null = null;
    for (let round = 0; round < 400; round++) {
      const { ran } = await jobs.runDueJobs({ handlers, limit: 50 });
      if (ran > 0) {
        idleSince = null;
        continue;
      }
      const stats = await jobs.getJobStats();
      if (stats.due > 0) continue;
      idleSince ??= Date.now();
      if (stats.scheduled === 0 || Date.now() - idleSince > idleBudgetMs) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  /** Signs a person in the way the app does (email link → session) and returns their user id. */
  async function signIn(address: string): Promise<string> {
    // No request info: the per-network sign-in limits are for people, and one seed run signs in a dozen accounts.
    await auth.requestSignIn({ email: address });
    const [mail] = await email.listOutbox({ to: address, template: "magic_link", limit: 1 });
    const link = mail ? email.extractLinks(mail.text).find((l) => l.includes("token=")) : undefined;
    if (!link) throw new Error(`No sign-in email was recorded for ${address}`);
    const token = new URL(link).searchParams.get("token");
    const result = await auth.consumeToken(token);
    return result.user.id;
  }

  async function findOrg(name: string, type: "sgo" | "business"): Promise<string | null> {
    const org = await orgs.getOrgBySlug(orgs.slugify(name));
    return org && org.type === type ? org.id : null;
  }

  /* -------- platform admin and the provisional (sandbox) SGO list */
  const adminUserId = await signIn(DEMO_LOGINS.admin);
  if (!(await auth.isPlatformAdmin(adminUserId))) throw new Error(`${DEMO_LOGINS.admin} did not become a platform admin`);
  say(`platform admin ${DEMO_LOGINS.admin}`);
  const listReport = await sgos.importSandboxProvisionalList(sys);
  say(`sandbox (fictional) provisional SGO list: ${listReport.rowCount} rows, ${listReport.added} added`);
  const entries = await sgos.listSgoListEntries({ source: "provisional_curated", state: "TX" }, { userId: adminUserId, request: REQUEST });

  async function ensureListedSgo(plan: { name: string; ein: string; city: string }, ownerEmail: string): Promise<string> {
    let orgId = await findOrg(plan.name, "sgo");
    if (!orgId) {
      orgId = (await sgos.createSgo({ name: plan.name, ein: plan.ein, city: plan.city, state: "TX", ownerEmail }, sys)).org.id;
      created.push(`SGO ${plan.name}`);
    } else skipped.push(`SGO ${plan.name}`);
    const entry = entries.find((e) => sgos.normalizeEin(e.ein ?? "") === sgos.normalizeEin(plan.ein));
    if (!entry) throw new Error(`${plan.name} is not in ${sgos.SANDBOX_PROVISIONAL_LIST_PATH}`);
    if (entry.linkedOrgId !== orgId) await sgos.linkProfileToListEntry(orgId, entry.id, { userId: adminUserId, request: REQUEST });
    await sgos.updateSgoProfile(orgId, { acceptsDonations: true, acceptsHandoffs: true, supportEmail: ownerEmail, description: "Fictional sandbox scholarship granting organization for the Passport demo. Not a real SGO." }, sys);
    return orgId;
  }

  const sgoA = await ensureListedSgo(DEMO_SGOS.primary, DEMO_LOGINS.sgoOwner);
  const sgoB = await ensureListedSgo(DEMO_SGOS.other, DEMO_LOGINS.otherSgoOwner);
  const ownerA = await signIn(DEMO_LOGINS.sgoOwner);
  const membersA = await orgs.listMembers(sgoA, { userId: ownerA });
  if (!membersA.some((m) => m.user.email === DEMO_LOGINS.sgoReviewer)) {
    await orgs.addMember({ orgId: sgoA, email: DEMO_LOGINS.sgoReviewer, role: "reviewer" }, { userId: ownerA, request: REQUEST });
    created.push(`reviewer ${DEMO_LOGINS.sgoReviewer}`);
  }
  const reviewerA = await signIn(DEMO_LOGINS.sgoReviewer);
  const reviewer: { type: "user"; id: string; mode: "test"; request: typeof REQUEST } = { type: "user", id: reviewerA, mode: "test", request: REQUEST };

  /* -------- SGO A integration: one sandbox API key and one webhook endpoint */
  let apiKey: string | null = null;
  const keys = await api.listApiKeys(sgoA, { mode: "test", activeOnly: true });
  if (keys.length === 0) {
    apiKey = (await api.createApiKey(sgoA, { name: "Demo integration (sandbox)", mode: "test" }, { type: "user", userId: ownerA, request: REQUEST })).secret;
    created.push("SGO API key (test mode)");
  } else skipped.push("SGO API key (already created; the secret is only shown once)");
  const webhookUrl = `http://localhost:${DEMO_WEBHOOK_PORT}${DEMO_WEBHOOK_PATH}`;
  let endpoint = (await webhooks.listEndpoints(sgoA)).find((e) => e.url === webhookUrl) ?? null;
  let webhookSecret: string | null = null;
  if (!endpoint) {
    const made = await webhooks.createEndpoint({ orgId: sgoA, url: webhookUrl, description: "Demo listener on this machine", eventTypes: ["*"] });
    endpoint = made.endpoint;
    webhookSecret = made.secret;
    created.push("webhook endpoint");
  } else skipped.push("webhook endpoint");

  /* -------- the camp, partnered with SGO A; allowed on this app's origin so /demo/camp can embed the button */
  let campId = await findOrg(DEMO_CAMP_NAME, "business");
  if (!campId) {
    campId = (await businesses.createBusiness({ name: DEMO_CAMP_NAME, vendorType: "summer_camp", billingEmail: "billing@camp-cedar-creek.example", ownerEmail: DEMO_LOGINS.campOwner }, bizSys)).org.id;
    created.push(`business ${DEMO_CAMP_NAME}`);
  } else skipped.push(`business ${DEMO_CAMP_NAME}`);
  const origins = [...new Set([new URL(appUrl("/")).origin, "http://localhost:3000"])];
  const { profile: campProfile } = await businesses.getBusinessProfile(campId);
  await businesses.updateBusinessProfile(campId, { allowedOrigins: [...new Set([...campProfile.allowedOrigins, ...origins])], brandColor: "#1f5c3f", holdWindowHours: 72 }, bizSys);
  const partnerships = await businesses.listPartnershipsForBusiness(campId);
  const withA = partnerships.find((p) => p.sgo.orgId === sgoA);
  if (!withA || withA.partnership.status !== "active") {
    const p = withA && withA.partnership.status === "pending" ? withA.partnership : await businesses.requestPartnership({ businessOrgId: campId, sgoOrgId: sgoA }, bizSys);
    await businesses.respondToPartnership(sgoA, p.id, "active", bizSys);
    created.push("partnership camp ↔ Lone Star");
  }

  /* -------- verifications in every state */
  const verificationIds: Partial<Record<ScenarioKey, string>> = {};

  async function existing(orgId: string, externalRef: string): Promise<string | null> {
    const page = await verifications.listVerifications(orgId, { mode: "test", externalRef, limit: 1 });
    return page.items[0]?.id ?? null;
  }

  async function family(plan: FamilyPlan) {
    const userId = await signIn(plan.email);
    const actor = { userId, request: REQUEST };
    const { household } = await households.getOrCreateHouseholdForUser(userId, { locale: "en" });
    await households.upsertOwnerMember(household.id, { ...plan.owner, relationship: "parent" }, actor);
    const view = await households.getHousehold(household.id, actor);
    const names = new Set(view.members.map((m) => `${m.firstName} ${m.lastName}`));
    if (!names.has(`${plan.student.firstName} ${plan.student.lastName}`)) await households.addMember(household.id, { kind: "student", ...plan.student, relationship: "self" }, actor);
    if (plan.extraAdult && !names.has(`${plan.extraAdult.firstName} ${plan.extraAdult.lastName}`)) await households.addMember(household.id, { kind: "adult", ...plan.extraAdult, relationship: "parent" }, actor);
    // No network lookups from the seed: the geocoder "fails", so the county comes from the ZIP or the family's choice.
    const offline: typeof fetch = () => Promise.reject(new Error("offline seed"));
    const addr = await households.updateAddress(household.id, { ...plan.address, line2: null, state: "TX" }, actor, { fetchImpl: offline });
    if (addr.status !== "resolved" || addr.county.fips !== plan.countyFips) await households.selectCounty(household.id, plan.countyFips, actor);
    return { userId, actor, householdId: household.id };
  }

  async function startFor(orgId: string, plan: FamilyPlan, externalRef: string) {
    const createdV = await verifications.createVerification({
      orgId,
      mode: "test",
      applicantEmail: plan.email,
      applicantName: `${plan.owner.firstName} ${plan.owner.lastName}`,
      studentFirstName: plan.student.firstName,
      studentLastName: plan.student.lastName,
      externalRef,
      createdBy: { type: "user", id: orgId === sgoA ? ownerA : adminUserId },
    });
    const fam = await family(plan);
    await verifications.startVerification(createdV.familyToken, fam.userId, { request: REQUEST });
    await verifications.recordSharingConsent(createdV.verification.id, fam.actor, { locale: "en" });
    await verifications.completeHousehold(createdV.verification.id, fam.actor, { custody: { livesInMultipleHouseholds: false } });
    return { id: createdV.verification.id, ...fam };
  }

  function w2(plan: FamilyPlan, box1Cents: number, control: string): Promise<Uint8Array> {
    const capped = Math.min(box1Cents, 17_610_000);
    return generateSyntheticDocument("w2", {
      statements: [
        {
          taxYear: 2025,
          copy: "B",
          employeeSsn: "000-00-0001",
          employerEin: "00-0000001",
          employerName: "FIXTURE FOODS LLC",
          employerAddress: { street: "500 SAMPLE PARKWAY", cityStateZip: "AUSTIN TX 78701" },
          controlNumber: control,
          employeeFirst: plan.owner.firstName.toUpperCase(),
          employeeLast: plan.owner.lastName.toUpperCase(),
          box1Cents,
          box2Cents: Math.round(box1Cents * 0.08),
          box3Cents: capped,
          box4Cents: Math.round(capped * 0.062),
          box5Cents: box1Cents,
          box6Cents: Math.round(box1Cents * 0.0145),
        },
      ],
    });
  }

  function snapLetter(plan: FamilyPlan): Promise<Uint8Array> {
    const name = `${plan.owner.firstName} ${plan.owner.lastName}`.toUpperCase();
    const student = `${plan.student.firstName} ${plan.student.lastName}`.toUpperCase();
    return generateSyntheticDocument("tf0001", {
      noticeDate: "2026-10-20",
      caseNumber: "9990000001",
      addressee: name,
      sections: [
        {
          heading: "SNAP Food Benefits",
          tables: [
            {
              status: "gets",
              subject: "SNAP food benefits",
              rows: [
                { name, edg: "990000011", program: "SNAP", start: "2026-10-20", end: "2027-03-31" },
                { name: student, edg: "990000011", program: "SNAP", start: "2026-10-20", end: "2027-03-31" },
              ],
            },
          ],
        },
      ],
    });
  }

  async function upload(id: string, actor: { userId: string }, kind: "w2" | "award_letter", bytes: Uint8Array, filename: string, contentType = "application/pdf") {
    return verifications.addDocument({ verificationId: id, declaredKind: kind, bytes, filename, contentType }, actor);
  }

  async function scenario(key: ScenarioKey, orgId: string, run: () => Promise<string>): Promise<void> {
    const ref = SCENARIOS[key];
    const found = await existing(orgId, ref);
    if (found) {
      verificationIds[key] = found;
      skipped.push(`verification ${ref}`);
      return;
    }
    verificationIds[key] = await run();
    await drain();
    const row = await verifications.getVerification(orgId, verificationIds[key]!, { mode: "test" });
    created.push(`verification ${ref} → ${row.status}${row.status === "pending" ? ` (${row.stage})` : ""}`);
    say(`${ref}: ${row.status}${row.status === "pending" ? ` (${row.stage})` : ""}`);
  }

  // Eligible via a SNAP letter: the layout is unverified, so it goes to review; the reviewer confirms the fields.
  await scenario("snapEligible", sgoA, async () => {
    const plan = FAMILIES.snapEligible;
    const v = await startFor(sgoA, plan, SCENARIOS.snapEligible);
    const added = await upload(v.id, v.actor, "award_letter", await snapLetter(plan), "snap-notice.pdf");
    await verifications.submit(v.id, v.actor);
    await drain();
    await verifications.assignReview(sgoA, v.id, reviewerA, reviewer);
    await verifications.saveReviewerExtraction(
      sgoA,
      added.document.id,
      {
        kind: "award_letter",
        notes: "Checked the notice: SNAP approved for the household, dated within 12 months.",
        award: {
          program: "SNAP",
          letterDate: "2026-10-20",
          approvalStatus: "approved",
          recipientName: `${plan.owner.firstName} ${plan.owner.lastName}`.toUpperCase(),
          issuingAgency: "Texas Health and Human Services Commission",
          benefitPeriod: { start: "2026-10-20", end: "2027-03-31" },
        },
      },
      reviewer,
    );
    await verifications.rerunDecision(sgoA, v.id, reviewer);
    return v.id;
  });

  // Eligible via a W-2 (the direct method): read automatically, decided by the engine.
  await scenario("w2Eligible", sgoA, async () => {
    const plan = FAMILIES.w2Eligible;
    const v = await startFor(sgoA, plan, SCENARIOS.w2Eligible);
    await upload(v.id, v.actor, "w2", await w2(plan, WAGES_CENTS.w2Eligible, "SYN-W2-0101"), "w2-2025.pdf");
    await verifications.signCertification(v.id, v.actor, { kind: "no_other_income", locale: "en" });
    await verifications.submit(v.id, v.actor);
    return v.id;
  });

  // Between the two readings of the proposed rule: the engine never decides that alone.
  await scenario("betweenReadings", sgoA, async () => {
    const plan = FAMILIES.betweenReadings;
    const v = await startFor(sgoA, plan, SCENARIOS.betweenReadings);
    await upload(v.id, v.actor, "w2", await w2(plan, WAGES_CENTS.betweenReadings, "SYN-W2-0201"), "w2-2025.pdf");
    await verifications.signCertification(v.id, v.actor, { kind: "no_other_income", locale: "en" });
    await verifications.submit(v.id, v.actor);
    return v.id;
  });

  // An unreadable scan (a photo with no text layer): left open in the review queue for a reviewer.
  await scenario("unreadableScan", sgoA, async () => {
    const plan = FAMILIES.unreadableScan;
    const v = await startFor(sgoA, plan, SCENARIOS.unreadableScan);
    const photo = await generateSyntheticDocument("image_png", { lines: ["SYNTHETIC SAMPLE - NOT A REAL DOCUMENT", "Form W-2 Wage and Tax Statement 2025", `${plan.owner.firstName} ${plan.owner.lastName}`.toUpperCase(), "Wages, tips, other compensation 46,200.00"] });
    await upload(v.id, v.actor, "w2", photo, "w2-photo.png", "image/png");
    await verifications.signCertification(v.id, v.actor, { kind: "no_other_income", locale: "en" });
    await verifications.submit(v.id, v.actor);
    return v.id;
  });

  // Awaiting the family: a second adult has no evidence yet, so it is pending (never ineligible for missing proof).
  await scenario("awaitingFamily", sgoA, async () => {
    const plan = FAMILIES.awaitingFamily;
    const v = await startFor(sgoA, plan, SCENARIOS.awaitingFamily);
    await upload(v.id, v.actor, "w2", await w2(plan, WAGES_CENTS.awaitingFamily, "SYN-W2-0301"), "w2-2025.pdf");
    await verifications.signCertification(v.id, v.actor, { kind: "no_other_income", locale: "en" });
    await verifications.submit(v.id, v.actor);
    return v.id;
  });

  // Ineligible: the evidence affirmatively shows income above both readings.
  await scenario("ineligible", sgoA, async () => {
    const plan = FAMILIES.ineligible;
    const v = await startFor(sgoA, plan, SCENARIOS.ineligible);
    await upload(v.id, v.actor, "w2", await w2(plan, WAGES_CENTS.ineligible, "SYN-W2-0401"), "w2-2025.pdf");
    await verifications.signCertification(v.id, v.actor, { kind: "no_other_income", locale: "en" });
    await verifications.submit(v.id, v.actor);
    return v.id;
  });

  // The other SGO has its own (not started) verification, used to show tenant isolation.
  await scenario("otherSgo", sgoB, async () => {
    const createdV = await verifications.createVerification({ orgId: sgoB, mode: "test", applicantEmail: "family.other@passport.test", externalRef: SCENARIOS.otherSgo, createdBy: { type: "user", id: adminUserId } });
    return createdV.verification.id;
  });

  /* -------- sandbox donations to SGO A: one single filer, one joint return */
  const sgoAOrg = await orgs.getOrg(sgoA);
  const existingGifts = await donations.listDonationsForSgo(sgoA, { mode: "test", limit: 100 }, { actor: { type: "system", id: "demo-seed" }, request: REQUEST });
  const giftEmails = new Set(existingGifts.items.map((g) => g.donor.email.toLowerCase()));

  async function give(patch: Parameters<typeof donations.saveCheckout>[1], label: string, donorEmail: string): Promise<void> {
    if (giftEmails.has(donorEmail)) {
      skipped.push(`donation ${label}`);
      return;
    }
    const { token } = await donations.startCheckout({ sgoSlug: sgoAOrg!.slug, source: "hosted" });
    await donations.saveCheckout(token, patch);
    await donations.saveCheckout(token, { designationConfirmed: true });
    const order = await donations.placeOrder(token, { request: REQUEST });
    const pay = order.payment;
    if (pay.provider !== "sandbox") throw new Error("The demo seed needs the sandbox payment processor (PAYMENTS_PROVIDER=sandbox).");
    await payments.confirmSandboxPayment({ paymentId: pay.paymentId, clientSecret: pay.clientSecret, cardNumber: "4242424242424242", expiry: "12/30", securityCode: "123" });
    await drain();
    created.push(`donation ${label}`);
    say(`donation ${label}`);
  }

  const attestations = { individual: true, usCitizenOrResident: true, noEarmark: true, notInExchangeForScholarship: true };
  await give(
    {
      giftCents: 170_000,
      filingStatus: "single",
      email: DEMO_LOGINS.donor,
      address: { line1: "800 Donor Drive", city: "Austin", state: "TX", zip: "78701" },
      contributors: { primary: { firstName: "Avery", lastName: "Donorsample", eDeliveryConsent: true } },
      attestations,
      donorTimeZone: "America/Chicago",
    },
    "single filer $1,700",
    DEMO_LOGINS.donor,
  );
  await give(
    {
      giftCents: 340_000,
      filingStatus: "married_joint",
      email: DEMO_LOGINS.jointDonor,
      address: { line1: "900 Couple Lane", city: "Houston", state: "TX", zip: "77002" },
      contributors: { primary: { firstName: "Jordan", lastName: "Testperson", eDeliveryConsent: true }, spouse: { firstName: "Riley", lastName: "Testperson", email: "riley.testperson@passport.test", eDeliveryConsent: true } },
      attestations: { ...attestations, jointOnBehalfOfBoth: true },
      donorTimeZone: "America/Chicago",
    },
    "joint return $3,400",
    DEMO_LOGINS.jointDonor,
  );

  /* -------- a camp booking handed to SGO A and held while the family's verification is reviewed */
  const heldAlready = (await handoffs.listHandoffs(campId, { mode: "test", limit: 100 })).data.find((h) => h.handoff.bookingRef === HANDOFF_BOOKING_REF);
  let handoffVerificationId: string | null = heldAlready?.handoff.verificationId ?? null;
  if (heldAlready) skipped.push(`handoff ${HANDOFF_BOOKING_REF}`);
  else {
    const campOwner = await signIn(DEMO_LOGINS.campOwner);
    const campKeys = await api.listApiKeys(campId, { mode: "test", activeOnly: true });
    const campKeyId = campKeys[0]?.id ?? (await api.createApiKey(campId, { name: "Camp booking system (sandbox)", mode: "test" }, { type: "user", userId: campOwner, request: REQUEST })).apiKey.id;
    const plan = FAMILIES.handoff;
    const made = await handoffs.createHandoff(
      { bookingRef: HANDOFF_BOOKING_REF, bookingDescription: "Session 2: Creek Explorers, June 14–18, 2027", bookingAmountCents: 45_000, familyEmail: plan.email, studentFirstName: plan.student.firstName, studentLastName: plan.student.lastName, channel: "redirect", sgoOrgId: sgoA },
      { kind: "api", businessOrgId: campId, mode: "test", apiKeyId: campKeyId, request: REQUEST },
    );
    const view = await handoffs.getHandoffView(made.token);
    if (!view.verificationUrl) throw new Error("The handoff did not create a verification link");
    const familyToken = new URL(view.verificationUrl).pathname.split("/").pop()!;
    const fam = await family(plan);
    const startedV = await verifications.startVerification(familyToken, fam.userId, { request: REQUEST });
    const vid = startedV.id;
    handoffVerificationId = vid;
    await verifications.recordSharingConsent(vid, fam.actor, { locale: "en" });
    await verifications.completeHousehold(vid, fam.actor, { custody: { livesInMultipleHouseholds: false } });
    await upload(vid, fam.actor, "award_letter", await snapLetter(plan), "snap-notice.pdf");
    await verifications.submit(vid, fam.actor);
    await drain();
    const synced = await handoffs.syncHandoffWithVerification(made.handoff.id);
    await drain();
    created.push(`handoff ${HANDOFF_BOOKING_REF} → ${synced?.status ?? "unchanged"}`);
    say(`handoff ${HANDOFF_BOOKING_REF}: ${synced?.status ?? "unchanged"}`);
  }

  await drain();
  listener?.close();

  const credentials: DemoCredentials = {
    appUrl: env().APP_URL,
    sgoOrgId: sgoA,
    otherSgoOrgId: sgoB,
    campOrgId: campId,
    apiKey,
    webhookEndpointId: endpoint.id,
    webhookUrl,
    webhookSecret,
    verifications: verificationIds as Record<ScenarioKey, string>,
    handoffBookingRef: HANDOFF_BOOKING_REF,
    handoffVerificationId,
  };
  const dataDir = opts.dataDir ?? env().ECCA_DATA_DIR;
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, CREDENTIALS_FILE);
  // Keep a secret captured on an earlier run: it is only ever returned once.
  if (existsSync(file)) {
    const previous = JSON.parse(readFileSync(file, "utf8")) as Partial<DemoCredentials>;
    credentials.apiKey ??= previous.apiKey ?? null;
    credentials.webhookSecret ??= previous.webhookSecret ?? null;
  }
  writeFileSync(file, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  return { credentials, created, skipped };
}

/** Reads the credentials file written by the seed. */
export function readDemoCredentials(dataDir: string): DemoCredentials | null {
  const file = join(dataDir, CREDENTIALS_FILE);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as DemoCredentials) : null;
}

/* ------------------------------------------------------------------------------------------------ cli */

async function main(): Promise<void> {
  loadEnvFiles();
  console.log("Seeding demo data (synthetic only)…");
  const { closeDb } = await import("@/db/client");
  const { env } = await import("@/lib/env");
  try {
    const { credentials, created, skipped } = await seedDemo();
    console.log(`\nDone: ${created.length} created, ${skipped.length} already there.`);
    const base = credentials.appUrl.replace(/\/$/, "");
    console.log(`
Sign in at ${base}/sign-in with one of these addresses. The 6-digit code (and a sign-in link)
appears in the development outbox at ${base}/dev/mail — no real email is ever sent.

  Platform admin console   ${DEMO_LOGINS.admin}            → ${base}/admin
  SGO dashboard (owner)    ${DEMO_LOGINS.sgoOwner}  → ${base}/sgo
  SGO reviewer             ${DEMO_LOGINS.sgoReviewer}  → ${base}/sgo/review
  Second SGO (isolation)   ${DEMO_LOGINS.otherSgoOwner}
  Camp partner portal      ${DEMO_LOGINS.campOwner}  → ${base}/partner
  Donor                    ${DEMO_LOGINS.donor}            → ${base}/donor

Public pages: ${base}/  ${base}/give  ${base}/demo/camp  ${base}/docs  ${base}/styleguide
Sandbox API key and webhook secret: ${join(env().ECCA_DATA_DIR, CREDENTIALS_FILE)}${credentials.apiKey ? "" : " (created on an earlier run)"}`);
  } finally {
    await closeDb();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed.ts")) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
