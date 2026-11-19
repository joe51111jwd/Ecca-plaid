/**
 * Records the founder walkthrough video: docs/demo/passport-walkthrough.mp4 plus docs/demo/walkthrough-script.md.
 *
 *   ECCA_DATA_DIR=.data-demo npm run db:seed                          (server stopped: PGlite is single-process)
 *   APP_URL=http://localhost:3217 ECCA_DATA_DIR=.data-demo NEXT_DIST_DIR=.next-demo npx next dev -p 3217
 *   npx tsx scripts/record-demo.ts --base-url http://localhost:3217 --data-dir .data-demo
 *
 * Options: --out <dir> (default docs/demo), --chapters 0,1,3 (record a subset; the mp4 is then a partial cut),
 * --keep (keep the raw recordings in the work directory), --ffmpeg <path> (default /usr/bin/ffmpeg, else on PATH).
 *
 * An explainer, not a trailer: full-screen title cards between chapters, and a caption bar on every app screen saying
 * what is happening and why the rule behind it exists. Each caption stays up for about 60 ms per character (at least
 * 3 seconds). Playwright records each chapter in its own browser context (1280x720; the family chapter in a 390x844
 * phone viewport, padded to 1280x720), ffmpeg normalizes and joins them (H.264, yuv420p, +faststart).
 *
 * The app must be the SEEDED demo (scripts/seed.ts). The script changes demo data as it goes (it confirms a letter,
 * resolves a review, makes a sandbox gift, offers an award), so re-seed a fresh data directory before re-recording.
 * Everything shown is synthetic.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { DEMO_LOGINS, DEMO_SGOS, HANDOFF_BOOKING_REF, readDemoCredentials, startDemoWebhookListener, type DemoCredentials } from "./seed";

/* ------------------------------------------------------------------------------------------------ settings */

/** Reading speed for captions and cards (the founder's brief: about 60 ms per character, at least 3 seconds). */
export const MS_PER_CHAR = 60;
export const MIN_CAPTION_MS = 3_000;
export const MIN_CARD_MS = 4_500;
export const DESKTOP = { width: 1280, height: 720 } as const;
export const PHONE = { width: 390, height: 844 } as const;
/** Pause after an action so a viewer sees what changed. */
const BEAT_MS = 900;
const TYPE_DELAY_MS = 35;
const SNAP_FIXTURE = join(process.cwd(), "tests", "fixtures", "synthetic", "SYNTHETIC_tf0001_snap_approved.pdf");

export function readingMs(text: string, min = MIN_CAPTION_MS): number {
  return Math.max(min, Math.round(text.length * MS_PER_CHAR));
}

/* ------------------------------------------------------------------------------------------------ timeline */

export interface TimelineEntry {
  chapter: number;
  /** Milliseconds from the start of the chapter's recording. */
  atMs: number;
  kind: "card" | "caption";
  lines: string[];
}

export interface ChapterSpec {
  id: number;
  title: string;
  phone?: boolean;
  run: (r: Recorder) => Promise<void>;
}

/** Formats milliseconds as m:ss. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The walkthrough as text: every card and caption with the time it appears in the final video. */
export function renderScript(chapters: ReadonlyArray<{ id: number; title: string }>, entries: readonly TimelineEntry[], starts: ReadonlyMap<number, number>, totalMs: number, generatedOn: string): string {
  const out: string[] = [
    "# Passport walkthrough — script",
    "",
    `The video (\`passport-walkthrough.mp4\`, ${clock(totalMs)}) read as text: every title card and every caption, with the time it appears. Recorded ${generatedOn} against the seeded sandbox. Everything shown is synthetic.`,
    "",
  ];
  for (const ch of chapters) {
    const start = starts.get(ch.id);
    if (start === undefined) continue;
    out.push(`## ${clock(start)} — Chapter ${ch.id}: ${ch.title}`, "");
    for (const e of entries.filter((x) => x.chapter === ch.id)) {
      const at = clock(start + e.atMs);
      if (e.kind === "card") {
        out.push(`**[${at}] Title card**`, "", ...e.lines.map((l) => `> ${l}`), "");
      } else {
        out.push(`- **[${at}]** ${e.lines.join(" ")}`);
      }
    }
    out.push("");
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/* ------------------------------------------------------------------------------------------------ overlays */

const CAPTION_ID = "__passport_demo_caption";

/** Injected into app pages: the caption bar, and the Next.js dev badge hidden (it is not part of the product). */
function applyOverlay(args: { id: string; text: string; phone: boolean }): void {
  const styleId = `${args.id}-style`;
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = "nextjs-portal{display:none!important}";
    document.head.appendChild(style);
  }
  let bar = document.getElementById(args.id);
  if (!bar) {
    bar = document.createElement("div");
    bar.id = args.id;
    bar.setAttribute("aria-hidden", "true");
    document.documentElement.appendChild(bar);
  }
  Object.assign(bar.style, {
    position: "fixed",
    left: "0",
    right: "0",
    bottom: "0",
    zIndex: "2147483647",
    background: "rgba(8, 33, 42, 0.94)",
    color: "#ffffff",
    font: args.phone ? "600 15px/1.4 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" : "600 21px/1.4 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    padding: args.phone ? "12px 16px 16px" : "14px 40px 18px",
    textAlign: "center",
    borderTop: "3px solid #D4921A",
    pointerEvents: "none",
    display: args.text ? "block" : "none",
  } satisfies Partial<CSSStyleDeclaration>);
  bar.textContent = args.text;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A full-screen title card in the product's own palette and type (brand-950 canvas, serif display, accent rule). */
export function cardHtml(kicker: string, title: string, lines: readonly string[]): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#08212A;color:#fff;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  main{box-sizing:border-box;height:100%;padding:72px 96px;display:flex;flex-direction:column;justify-content:center}
  .k{color:#F4C552;font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:20px;margin:0 0 18px}
  h1{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Charter,Georgia,"Noto Serif",serif;font-weight:600;font-size:56px;line-height:1.08;margin:0 0 30px;max-width:1050px}
  .rule{width:96px;height:4px;background:#D4921A;margin:0 0 30px}
  ul{list-style:none;padding:0;margin:0;max-width:1050px}
  li{font-size:27px;line-height:1.38;margin:0 0 14px;color:#D9EBEF;padding-left:30px;position:relative}
  li:before{content:"";position:absolute;left:0;top:15px;width:12px;height:12px;border-radius:3px;background:#5298AA}
  .brand{position:absolute;left:96px;bottom:44px;font-weight:700;font-size:20px;color:#86BAC7}
  .sandbox{position:absolute;right:96px;bottom:44px;font-size:17px;color:#86BAC7}
  </style></head><body><main><p class="k">${escapeHtml(kicker)}</p><h1>${escapeHtml(title)}</h1><div class="rule"></div><ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul></main>
  <div class="brand">Passport</div><div class="sandbox">Sandbox demo · synthetic data only</div></body></html>`;
}

/* ------------------------------------------------------------------------------------------------ recorder */

export class Recorder {
  readonly entries: TimelineEntry[] = [];
  page!: Page;
  context!: BrowserContext;
  private t0 = 0;
  private current = "";

  constructor(
    readonly chapter: number,
    readonly phone: boolean,
    readonly base: string,
  ) {}

  async open(browser: Browser, videoDir: string, storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>): Promise<void> {
    const size = this.phone ? PHONE : DESKTOP;
    this.context = await browser.newContext({
      viewport: size,
      recordVideo: { dir: videoDir, size },
      baseURL: this.base,
      ...(this.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}),
      ...(storageState ? { storageState } : {}),
    });
    this.page = await this.context.newPage();
    this.t0 = Date.now();
    this.page.on("domcontentloaded", () => {
      void this.page.evaluate(applyOverlay, { id: CAPTION_ID, text: this.current, phone: this.phone }).catch(() => undefined);
    });
  }

  private mark(kind: TimelineEntry["kind"], lines: string[]): void {
    this.entries.push({ chapter: this.chapter, atMs: Date.now() - this.t0, kind, lines });
  }

  async pause(ms = BEAT_MS): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /** Puts a caption on screen and keeps it there long enough to read. */
  async say(text: string): Promise<void> {
    this.current = text;
    await this.page.evaluate(applyOverlay, { id: CAPTION_ID, text, phone: this.phone }).catch(() => undefined);
    this.mark("caption", [text]);
    await this.page.waitForTimeout(readingMs(text));
  }

  /** Sets the caption without waiting (the next actions happen under it). */
  async caption(text: string): Promise<void> {
    this.current = text;
    await this.page.evaluate(applyOverlay, { id: CAPTION_ID, text, phone: this.phone }).catch(() => undefined);
    this.mark("caption", [text]);
  }

  /** A full-screen title card. */
  async card(kicker: string, title: string, lines: readonly string[]): Promise<void> {
    this.current = "";
    await this.page.setContent(cardHtml(kicker, title, lines));
    this.mark("card", [`${kicker}: ${title}`, ...lines]);
    await this.page.waitForTimeout(readingMs([title, ...lines].join(" "), MIN_CARD_MS));
  }

  async goto(path: string): Promise<void> {
    await this.page.goto(path);
    await this.page.waitForLoadState("networkidle").catch(() => undefined);
  }

  /** Scrolls an element to the top of the viewport (smoothly) and waits a beat. */
  async show(selector: Parameters<Page["locator"]>[0] | ReturnType<Page["locator"]>, offset = 90): Promise<void> {
    const loc = typeof selector === "string" ? this.page.locator(selector).first() : selector.first();
    await loc.waitFor({ state: "attached" });
    await loc.evaluate((el, off) => {
      const y = el.getBoundingClientRect().top + window.scrollY - off;
      window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    }, offset);
    await this.pause(1_100);
  }

  /** Scrolls down by `px` in small steps (human-speed, smooth). */
  async scrollBy(px: number, stepPx = 14, stepMs = 16): Promise<void> {
    const steps = Math.ceil(Math.abs(px) / stepPx);
    for (let i = 0; i < steps; i++) {
      await this.page.mouse.wheel(0, Math.sign(px) * stepPx);
      await this.page.waitForTimeout(stepMs);
    }
    await this.pause(500);
  }

  async type(locator: ReturnType<Page["locator"]>, text: string): Promise<void> {
    await locator.click();
    await locator.pressSequentially(text, { delay: TYPE_DELAY_MS });
  }

  async close(): Promise<string> {
    const video = this.page.video();
    await this.context.close();
    if (!video) throw new Error(`Chapter ${this.chapter} produced no video`);
    return video.path();
  }
}

/* ------------------------------------------------------------------------------------------------ app steps */

interface Ctx {
  base: string;
  creds: DemoCredentials;
  browser: Browser;
  /** Signed-in browser state per address, captured off camera. */
  sessions: Map<string, Awaited<ReturnType<BrowserContext["storageState"]>>>;
  /** Filled by chapter 2: the verification the family completed on camera. */
  familyVerificationId?: string;
}

async function latestSignInCode(page: Page, email: string, since: number): Promise<{ code: string; link: string }> {
  for (let i = 0; i < 40; i++) {
    const res = await page.request.get(`/dev/mail/latest?template=magic_link&to=${encodeURIComponent(email)}`);
    if (res.ok()) {
      const mail = (await res.json()) as { text: string; links: string[]; createdAt: string };
      const code = /\b(\d{6})\b/.exec(mail.text)?.[1];
      const link = mail.links.find((l) => l.includes("token="));
      if (code && link && Date.parse(mail.createdAt) >= since - 1_000) return { code, link };
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`No sign-in email arrived for ${email}`);
}

/** Signs a person in off camera and keeps the session for the chapters that need it. */
async function session(ctx: Ctx, email: string): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const known = ctx.sessions.get(email);
  if (known) return known;
  const context = await ctx.browser.newContext({ baseURL: ctx.base });
  const page = await context.newPage();
  const since = Date.now();
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByText("Check your email").waitFor();
  const { link } = await latestSignInCode(page, email, since);
  await page.goto(link);
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in") && !u.pathname.startsWith("/auth"));
  const state = await context.storageState();
  await context.close();
  ctx.sessions.set(email, state);
  return state;
}

async function api<T>(ctx: Ctx, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (!ctx.creds.apiKey) throw new Error("The seeded API key is missing from the credentials file; re-seed a fresh data directory.");
  const res = await fetch(`${ctx.base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${ctx.creds.apiKey}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function drain(ctx: Ctx): Promise<void> {
  await fetch(`${ctx.base}/api/internal/jobs/run?drain=1`, { method: "POST" });
}

/** Opens the keying form for an uploaded file on the SGO verification page. */
async function openKeying(r: Recorder, filename: string) {
  const form = r.page.getByRole("form", { name: `Key fields for ${filename}` });
  if (!(await form.isVisible())) await r.page.getByText("Key or correct the fields").first().click();
  await form.waitFor();
  return form;
}

async function confirmSnapLetter(r: Recorder, ctx: Ctx, filename: string, recipient: string, letterDate: string): Promise<void> {
  const form = await openKeying(r, filename);
  await r.show(form, 120);
  await form.getByLabel("What this document is").selectOption({ label: "Benefits award letter" });
  await form.getByLabel("Program").selectOption({ label: "SNAP" });
  await form.getByLabel("Letter date(optional)").fill(letterDate);
  await form.getByLabel("What the letter shows").selectOption({ label: "Approved" });
  await r.type(form.getByLabel("Recipient as printed(optional)"), recipient);
  await form.getByLabel("Issuing agency(optional)").fill("Texas Health and Human Services Commission");
  await r.pause();
  await form.getByRole("button", { name: "Save keyed fields" }).click();
  await r.page.getByText(/Saved \d+ keyed fields?/).waitFor();
  await r.pause();
  const rerun = r.page.getByRole("region", { name: "Re-run the check" });
  await r.show(rerun, 160);
  await rerun.getByRole("button", { name: "Re-run the check" }).click();
  await r.pause(1_500);
  await drain(ctx);
  await r.page.reload();
  await r.page.waitForLoadState("networkidle").catch(() => undefined);
}

async function waitForEvidence(r: Recorder, ctx: Ctx): Promise<{ pdf: string; json: string }> {
  for (let i = 0; i < 30; i++) {
    const json = r.page.getByRole("link", { name: "Signed JSON" });
    if (await json.isVisible()) {
      return { json: (await json.getAttribute("href"))!, pdf: (await r.page.getByRole("link", { name: "PDF", exact: true }).getAttribute("href"))! };
    }
    await drain(ctx);
    await r.page.waitForTimeout(1_000);
    await r.page.reload();
  }
  throw new Error("The evidence pack was not generated");
}

/**
 * Renders a PDF's pages to images inside the browser with pdfjs-dist (served from node_modules through a routed
 * origin), because the headless PDF viewer does not record. Returns PNG data URLs.
 */
async function renderPdfPages(browser: Browser, pdf: Buffer): Promise<string[]> {
  const origin = "https://render.passport-demo.invalid";
  const build = join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build");
  const context = await browser.newContext({ viewport: { width: 1000, height: 1400 } });
  const page = await context.newPage();
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/doc.pdf") return route.fulfill({ body: pdf, contentType: "application/pdf" });
    if (path === "/") return route.fulfill({ body: "<!DOCTYPE html><html><body></body></html>", contentType: "text/html" });
    const file = join(build, path.replace(/^\//, ""));
    if (!file.startsWith(build) || !existsSync(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ body: readFileSync(file), contentType: "text/javascript" });
  });
  await page.goto(`${origin}/`);
  const images = await page.evaluate(async (o) => {
    const pdfjs = (await import(`${o}/pdf.mjs`)) as { GlobalWorkerOptions: { workerSrc: string }; getDocument: (src: string) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getViewport: (p: { scale: number }) => { width: number; height: number }; render: (p: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> } }> }> } };
    pdfjs.GlobalWorkerOptions.workerSrc = `${o}/pdf.worker.mjs`;
    const doc = await pdfjs.getDocument(`${o}/doc.pdf`).promise;
    const out: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n);
      const viewport = pg.getViewport({ scale: 1.6 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await pg.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
      out.push(canvas.toDataURL("image/png"));
    }
    return out;
  }, origin);
  await context.close();
  return images;
}

function pdfViewerHtml(title: string, images: readonly string[]): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#394245;font-family:ui-sans-serif,system-ui,sans-serif}
  header{position:sticky;top:0;background:#08212A;color:#fff;padding:14px 32px;font-weight:600;font-size:18px;z-index:2}
  .pages{display:flex;flex-direction:column;align-items:center;gap:28px;padding:28px 0 160px}
  img{width:820px;box-shadow:0 8px 30px rgba(0,0,0,.45);background:#fff}
  .n{color:#DEE2E2;font-size:14px;margin-top:-18px}
  </style></head><body><header>${escapeHtml(title)}</header><div class="pages">${images.map((src, i) => `<img alt="" src="${src}"><div class="n">Page ${i + 1} of ${images.length}</div>`).join("")}</div></body></html>`;
}

/* ------------------------------------------------------------------------------------------------ chapters */

function chapters(ctx: Ctx): ChapterSpec[] {
  const v = ctx.creds.verifications;
  return [
    {
      id: 0,
      title: "What this is",
      run: async (r) => {
        await r.card("Passport · walkthrough", "Income verification and tax-credit giving for the federal scholarship tax credit", [
          "Built for the Texas wedge of IRC section 25F, to the October 2026 proposed rules (not final).",
          "One app, three pieces, one shared verification engine.",
          "This video shows every screen and explains the rule behind each step.",
        ]);
        await r.card("The three pieces", "Who uses what", [
          "Donor checkout — individuals give to a listed scholarship organization (SGO) and see the credit math.",
          "Family intake — a parent verifies household income once, from an SGO link or a camp's checkout.",
          "Verification core — the SGO's dashboard and API: decisions, human review, evidence packs.",
        ]);
        await r.card("What you are about to see", "Eight short chapters", [
          "The website, then a family verifying on a phone.",
          "The SGO dashboard — the longest part, because it is what an organization buys.",
          "A donor's sandbox gift, the camp handoff, your admin console, and what is real versus sandbox.",
        ]);
      },
    },
    {
      id: 1,
      title: "The website",
      run: async (r) => {
        await r.card("Chapter 1", "The website", ["The public home page at /: what Passport is, the key dates, and the ground rules it is built on."]);
        await r.goto("/");
        await r.say("The home page: one line on what Passport does, and the dates that drive everything — the credit starts January 1, 2027.");
        await r.show('[aria-label="Key dates and limits"]', 200);
        await r.say("Key facts from the statute and proposed rules: the $1,700 cap per taxpayer and the 300%-of-area-median income limit.");
        const melt = r.page.locator(".site-melt").first();
        await r.show(melt, 0);
        await r.caption("How it works: a sample sheet of paperwork is scanned and melts into a single answer.");
        const height = await melt.evaluate((el) => el.getBoundingClientRect().height);
        await r.scrollBy(Math.max(600, height - 500), 8, 22);
        await r.say("The result chip: eligible, labeled provisional — because the IRS has not published its own income limits yet.");
        await r.show('section[aria-labelledby="site-honest-title"]', 40);
        await r.say("The ground rules, stated up front: proposed rules, provisional limits, eligible is not an award, families never pay.");
        await r.scrollBy(900, 14, 18);
        await r.say("Each audience has its own door: donors give, families apply, organizations verify, camps add the button.");
      },
    },
    {
      id: 2,
      title: "A family verifies (phone)",
      phone: true,
      run: async (r) => {
        const email = `dana.walkthrough.${Date.now().toString(36)}@passport.test`;
        const created = await api<{ id: string; family_url: string }>(ctx, "POST", "/api/v1/verifications", {
          external_ref: "DEMO-WALKTHROUGH",
          applicant_email: email,
          applicant_name: "Dana Sample",
          student: { first_name: "Riley", last_name: "Sample" },
        });
        ctx.familyVerificationId = created.id;
        const link = new URL(created.family_url);
        await r.page.setContent(cardHtml("Chapter 2", "A family verifies", ["On a phone, from the SGO's link.", "Families never pay. Eligible is not a promise of an award."]));
        await r.pause(5_000);
        await r.goto(link.pathname);
        await r.say("The SGO sent this family a link. The page says who is asking, what will happen, and that checking income is not a promise of a scholarship.");
        await r.show(r.page.getByRole("heading", { name: "Sign in to start" }), 80);
        await r.type(r.page.getByLabel("Your email address"), email);
        const since = Date.now();
        await r.page.getByRole("button", { name: "Email me a code" }).click();
        await r.page.getByText("Check your email").waitFor();
        await r.say("No password: a single-use code is emailed. In this sandbox emails land in the development outbox at /dev/mail.");
        const { code } = await latestSignInCode(r.page, email, since);
        await r.type(r.page.getByLabel("Digit 1 of 6"), code);
        await r.page.waitForURL(/\/consent$/);
        await r.page.waitForLoadState("networkidle").catch(() => undefined);
        await r.say("Permission first, in plain language: who gets what, for what purpose and for how long. The exact wording and its version are stored.");
        await r.scrollBy(1200, 12, 20);
        await r.page.getByRole("checkbox", { name: /I am the adult in charge/ }).check();
        await r.say("Checking the box is the parent's written instruction to share — the consumer-directed design the FCRA constraint calls for.");
        await r.page.getByRole("button", { name: "Give permission and continue" }).click();
        await r.page.getByRole("heading", { name: "Where do you live?" }).waitFor();
        await r.caption("The address decides the Texas county, and the county decides the income limit.");
        await r.type(r.page.getByLabel("Street address"), "100 Fixture Lane");
        await r.type(r.page.getByLabel("City"), "Houston");
        await r.type(r.page.getByLabel("ZIP code"), "77002");
        await r.pause();
        await r.page.getByRole("button", { name: "Save address" }).click();
        await r.page.getByRole("heading", { name: "First, tell us about you" }).waitFor();
        await r.say("Resolved to Harris County. If a ZIP spans counties the family picks — a wrong county would be a wrong limit, so it is never guessed.");
        await r.type(r.page.getByLabel("First name"), "Dana");
        await r.type(r.page.getByLabel("Last name"), "Sample");
        await r.page.getByRole("button", { name: "Continue" }).click();
        await r.page.getByRole("heading", { name: "Who lives with your student?" }).waitFor();
        await r.caption("Household size follows the proposed household definition: the student and everyone living with them.");
        await r.page.getByRole("link", { name: "Add a person" }).click();
        await r.type(r.page.getByLabel("First name"), "Riley");
        await r.type(r.page.getByLabel("Last name"), "Sample");
        await r.page.getByRole("radio", { name: /^Student applying for the scholarship/ }).check();
        await r.pause();
        await r.page.getByRole("button", { name: "Save person" }).click();
        await r.page.getByRole("link", { name: "Everyone is listed" }).waitFor();
        await r.pause(1_500);
        await r.page.getByRole("link", { name: "Everyone is listed" }).click();
        await r.page.getByRole("heading", { name: "Where does your student live?" }).waitFor();
        await r.say("Shared custody is never guessed: if the student lives in two homes, the answers go to a reviewer.");
        await r.page.getByRole("radio", { name: "No, only in my home" }).check();
        await r.page.getByRole("button", { name: "Save and continue" }).click();
        await r.page.getByRole("heading", { name: "How do you want to show your income?" }).waitFor();
        await r.say("Upload, or connect a licensed payroll or bank rail (simulated here). It is a preference, not a trap: switching loses nothing.");
        await r.page.getByRole("button", { name: "Continue" }).click();
        await r.page.getByRole("heading", { name: "Upload your documents" }).waitFor();
        await r.page.getByRole("radio", { name: /^Benefits letter/ }).check();
        await r.caption("A SNAP approval letter dated within 12 months proves eligibility by the categorical method. This one is synthetic.");
        await r.page.getByLabel("Choose files").setInputFiles(SNAP_FIXTURE);
        await r.page.getByRole("region", { name: "Your documents" }).getByRole("button", { name: /^Remove / }).waitFor();
        await r.pause(3_500);
        await r.page.getByRole("link", { name: "Review and send" }).click();
        await r.page.getByRole("heading", { name: "Review and send" }).waitFor();
        await r.say("The family checks everything once, then sends it.");
        await r.page.getByRole("button", { name: "Send for checking" }).click();
        await r.page.waitForURL(/\/status$/);
        await drain(ctx);
        await r.page.reload();
        await r.page.waitForLoadState("networkidle").catch(() => undefined);
        await r.say("Result: a person will look. The TF0001 letter layout is not yet verified, so the engine never says yes on it alone — no silent yes.");
        await r.scrollBy(500);
        await r.say("Families never pay to verify. And eligible is not a promise of a scholarship: the SGO decides awards separately.");
      },
    },
    {
      id: 3,
      title: "The SGO dashboard",
      run: async (r) => {
        await r.card("Chapter 3", "The SGO dashboard", [
          "What a scholarship organization buys: the queue, the decisions, human review, evidence packs, giving records and the API.",
          `Signed in as the owner of “${DEMO_SGOS.primary.name}”, a fictional sandbox SGO.`,
        ]);
        await r.goto("/sgo");
        await r.say("Home: what needs attention — cases waiting for a reviewer, donors who need donor numbers, setup steps left.");
        await r.show('section[aria-labelledby], [aria-label="Verifications by status"]', 120);
        await r.say("Verifications by status. Every count carries the reminder that limits are HUD-derived and provisional, and that eligible is not an award.");
        await r.scrollBy(700);
        await r.say("The reporting calendar for gifts: acknowledgments are due January 31, the IRS contribution report February 28.");
        await r.goto("/sgo/verifications");
        await r.say("The verification queue: every family the SGO asked to verify, with status and the SGO's own reference.");
        await r.goto("/sgo/review");
        await r.say("The review queue: what the engine could not decide, oldest first, each with the reason in plain words.");

        // The family's letter from chapter 2.
        if (ctx.familyVerificationId) {
          await r.goto(`/sgo/verifications/${ctx.familyVerificationId}`);
          await r.say("This is the family from chapter 2. A reviewer reads the letter and confirms what it shows.");
          await confirmSnapLetter(r, ctx, "SYNTHETIC_tf0001_snap_approved.pdf", "DANA SAMPLE", "2026-09-15");
          await r.show(r.page.getByRole("heading", { name: "Decision" }), 90);
          await r.say("Eligible by the categorical method: SNAP approval dated within 12 months. Marked PROVISIONAL, because the limit table is HUD-derived.");
          await r.show(r.page.getByRole("region", { name: /The limit used/ }), 90);
          await r.say("The limit used, its source, table version and effective date are recorded with every decision — the proof an auditor asks for.");
          await r.show(r.page.getByRole("region", { name: "Timeline" }), 90);
          await r.say("The timeline: every step by the family, the system and the reviewer, with times. Reads of sensitive data are audited too.");
        }

        // Two readings where they differ.
        await r.goto(`/sgo/verifications/${v.betweenReadings}`);
        await r.say("Starr County. The proposed rule can be read two ways, and here the readings differ: $92,880 versus $201,000 for two people.");
        await r.show(r.page.getByRole("table", { name: "Readings of the limit" }), 160);
        await r.say("This household's income falls between them. The engine decides only where both readings agree, so a person decides this one.");

        // A decided verification and its evidence pack.
        await r.goto(`/sgo/verifications/${v.w2Eligible}`);
        await r.say("A W-2 case read automatically and decided by the engine: direct method, prior-year wages compared with the Travis County limit.");
        const evidence = await waitForEvidence(r, ctx);
        await r.show(r.page.getByRole("link", { name: "Signed JSON" }), 250);
        await r.say("Every decided case has an evidence pack: a PDF for people and a signed JSON record for machines. Downloads are audited.");
        const pdf = await r.page.request.get(evidence.pdf);
        if (pdf.ok()) {
          const images = await renderPdfPages(ctx.browser, await pdf.body());
          await r.page.setContent(pdfViewerHtml("Evidence pack (PDF) — synthetic", images));
          await r.say("The evidence pack PDF: decision, method, household size, area, the limit and its source, and both readings.");
          await r.scrollBy(1300, 16, 18);
          await r.say("Extracted fields, file hashes instead of raw files, the consent record with version and timestamp, and who reviewed what.");
          await r.scrollBy(1300, 16, 18);
        }
        await r.goto(evidence.json);
        await r.say("The same facts as a signed JSON record (Ed25519). Anyone can check it against /.well-known/jwks.json with npm run evidence:verify.");

        // The review queue: an unreadable scan resolved by a reviewer.
        await r.goto("/sgo/review");
        await r.say("Back to the review queue: a family uploaded a phone photo of a W-2. Photos have no text layer, so nothing is guessed.");
        await r.goto(`/sgo/verifications/${v.unreadableScan}`);
        await r.page.getByRole("link", { name: "View file" }).first().click();
        await r.page.getByRole("dialog").waitFor();
        await r.say("The reviewer opens the file. Opening it is written to the audit log.");
        await r.page.keyboard.press("Escape");
        await r.pause();
        const form = await openKeying(r, "w2-photo.png");
        await r.show(form, 120);
        await r.caption("The reviewer keys the figure from the photo: 2025 W-2 wages, box 1.");
        await form.getByLabel("Tax year(optional)").fill("2025");
        await form.getByLabel("Figure 1").selectOption({ label: "W-2: Wages (box 1)" });
        await r.type(form.getByLabel("Amount (USD)").first(), "46200");
        await r.type(form.getByLabel("Person").first(), "ADA TESTCASE");
        await form.getByLabel("Payer").first().fill("FIXTURE FOODS LLC");
        await r.pause();
        await form.getByRole("button", { name: "Save keyed fields" }).click();
        await r.page.getByText(/Saved \d+ keyed fields?/).waitFor();
        const rerun = r.page.getByRole("region", { name: "Re-run the check" });
        await r.show(rerun, 160);
        await rerun.getByRole("button", { name: "Re-run the check" }).click();
        await r.pause(1_500);
        await drain(ctx);
        await r.page.reload();
        await r.page.waitForLoadState("networkidle").catch(() => undefined);
        await r.show(r.page.getByRole("heading", { name: "Decision" }), 90);
        await r.say("The engine decides again with the keyed figure: eligible, direct method. The evidence pack records that a reviewer keyed it.");

        // Giving records.
        await r.goto("/sgo/donations");
        await r.say("Donations: each sandbox gift with the designated amount, kept separate from any fee, and the donor's consent to electronic delivery.");
        await r.goto("/sgo/acknowledgments");
        await r.say("Acknowledgments: one per donor per year, with the SGO's EIN and a unique donor number from the IRS SGO portal — never invented.");
        await r.goto("/sgo/irs-report");
        await r.say("The IRS report page assembles the annual contribution report (name, address, donor number, total designated), due February 28.");
        await r.goto("/sgo/developers");
        await r.say("Developers: test API keys (stored only as hashes) and webhook endpoints with a log of every signed delivery.");
        await r.scrollBy(500);
        await r.goto("/docs");
        await r.say("The API documentation: create a verification, read it, receive a signed webhook when the decision is ready.");
      },
    },
    {
      id: 4,
      title: "A donor gives",
      run: async (r) => {
        await r.card("Chapter 4", "A donor gives", [
          "Individuals only, to an SGO on the list.",
          "Before January 1, 2027 gifts work in the sandbox and are plainly marked not credit-eligible.",
        ]);
        await r.goto("/give");
        await r.say("Search is limited to listed SGOs. Until the IRS publishes its list, the list is our provisional one — and it says so.");
        await r.type(r.page.getByRole("searchbox", { name: "Search by organization name or EIN" }), "Lone Star");
        await r.page.getByRole("button", { name: "Search" }).click();
        await r.pause(1_500);
        await r.page.getByRole("link", { name: "Give to this organization" }).first().click();
        await r.page.getByLabel("Gift amount").waitFor();
        await r.type(r.page.getByLabel("Gift amount"), "1700");
        await r.page.getByRole("button", { name: "Start your gift" }).click();
        await r.page.getByRole("region", { name: "Federal tax credit preview" }).waitFor();
        await r.pause(1_500);
        await r.say("The tax-math panel: the $1,700 cap, joint returns, state-credit reduction, nonrefundable, five-year carryforward. A preview, not tax advice.");
        await r.show(r.page.getByRole("region", { name: "Federal tax credit preview" }), 90);
        await r.say("The banner: a sandbox gift, not credit-eligible — the credit starts January 1, 2027, the list is provisional, and the SGO is not portal-registered.");
        await r.say("The panel never invents the donor's tax liability: it only helps if the donor owes enough federal tax.");
        await r.page.getByRole("button", { name: "Continue" }).click();
        await r.page.getByRole("radio", { name: "Single" }).check();
        await r.type(r.page.getByLabel("First name"), "Avery");
        await r.type(r.page.getByLabel("Last name"), "Walkthrough");
        await r.type(r.page.getByLabel("Email address"), "donor.walkthrough@passport.test");
        await r.page.getByLabel("Street address").fill("800 Donor Drive");
        await r.page.getByLabel("City").fill("Austin");
        await r.page.getByRole("combobox", { name: "State", exact: true }).selectOption("TX");
        await r.page.getByLabel("ZIP code").fill("78701");
        await r.say("Name and address for the acknowledgment and the IRS report. No Social Security number or TIN is ever collected.");
        await r.page.getByRole("button", { name: "Continue" }).click();
        const confirm = r.page.getByRole("region", { name: "Confirm your gift" });
        await confirm.waitFor();
        await r.say("Individuals only; no earmarking for a named student; and the designation in exact words, made at the time of payment.");
        for (const box of await confirm.getByRole("checkbox").all()) {
          await box.check();
          await r.pause(400);
        }
        await r.show(confirm.getByText(/I designate \$1,700/), 160);
        await r.say("The designation is irrevocable and stored with the exact words and their hash. There is no un-designate and no self-serve refund.");
        await r.page.getByRole("button", { name: "Continue" }).click();
        await r.page.getByRole("region", { name: "What you will be charged" }).waitFor();
        await r.say("The designated amount and any fee are always separate lines. With the fee structure at none, there is no fee at all.");
        await r.page.getByRole("button", { name: "Continue to payment" }).click();
        await r.page.getByRole("button", { name: /Use test number 4242 4242 4242 4242:/ }).click();
        await r.page.getByLabel("Expiry date").fill("12/30");
        await r.page.getByLabel("Security code").fill("123");
        await r.say("Sandbox payment with a test card number: no money moves. In production this is a Stripe charge on the SGO's own account.");
        await r.page.getByRole("button", { name: "Complete sandbox gift" }).click();
        await r.page.waitForURL(/\/thanks\?/);
        await r.page.waitForLoadState("networkidle").catch(() => undefined);
        await r.say("The immediate receipt — not the official acknowledgment, which the SGO sends by January 31 with the unique donor number.");
        await r.scrollBy(450);
        await r.say("The reasons it is not credit-eligible are listed one by one, so nobody is told a gift is free when it is not.");
        await r.goto("/dev/mail");
        await r.page.getByRole("link", { name: /Payment receipt for your gift/ }).first().click();
        await r.page.waitForLoadState("networkidle").catch(() => undefined);
        await r.say("The receipt email, as the development outbox recorded it. In production it is sent through an email provider.");
      },
    },
    {
      id: 5,
      title: "The camp handoff",
      run: async (r) => {
        await r.card("Chapter 5", "The camp handoff", [
          "A fictional summer camp's checkout with a “Pay with a scholarship” button.",
          "The camp pays the success fee on its own invoice. The family never pays; scholarship funds are never touched.",
        ]);
        await r.goto("/demo/camp");
        await r.say("Camp Cedar Creek is a fictional booking site that installs the real embed script. Pick a session.");
        await r.page.getByRole("link", { name: "Book this session" }).nth(1).click();
        await r.page.getByRole("heading", { name: "Checkout" }).waitFor();
        await r.say("At checkout the family can pay with a scholarship. The camp's page receives events as the handoff moves.");
        await r.page.getByRole("button", { name: "Pay with a scholarship" }).click();
        await r.page.waitForURL(/\/h\//);
        await r.page.waitForLoadState("networkidle").catch(() => undefined);
        await r.say("The family's handoff page: the camp holds the spot until a stated deadline instead of silently dropping the sale.");
        await r.say("It names the partner SGO, says verifying is free for families, and that verifying does not guarantee a scholarship.");
        const campState = await session(ctx, DEMO_LOGINS.campOwner);
        await r.context.addCookies(campState.cookies);
        await r.goto("/partner/handoffs");
        await r.say(`The camp's partner portal. Booking ${HANDOFF_BOOKING_REF} (seeded): that family submitted, so the spot is held while the SGO reviews.`);
        const sgoState = await session(ctx, DEMO_LOGINS.sgoOwner);
        await r.context.addCookies(sgoState.cookies);
        if (ctx.creds.handoffVerificationId) {
          await r.goto(`/sgo/verifications/${ctx.creds.handoffVerificationId}`);
          await r.say("On the SGO side, the reviewer confirms that family's SNAP letter.");
          await confirmSnapLetter(r, ctx, "snap-notice.pdf", "TASHA DEMO", "2026-10-20");
          await r.show(r.page.getByRole("heading", { name: "Award", exact: true }), 90);
          await r.say("Eligible. An award is a separate, explicit decision of the SGO — never automatic after verification.");
          await r.page.getByLabel("Amount (USD)").last().fill("450");
          await r.page.getByLabel("How it will be paid").selectOption({ label: "Paid directly to the school or vendor" });
          await r.page.getByRole("checkbox", { name: /I have read the compliance reminders/ }).check();
          await r.pause();
          await r.page.getByRole("button", { name: "Offer award" }).click();
          await r.page.getByRole("dialog").getByRole("button", { name: "Offer award" }).click();
          await r.pause(1_500);
          await drain(ctx);
          await r.goto("/partner/handoffs");
          await r.say(`Back in the camp's portal, ${HANDOFF_BOOKING_REF} now reads Awarded. The camp completes the booking; its success fee goes on its own invoice.`);
        }
      },
    },
    {
      id: 6,
      title: "Your admin console",
      run: async (r) => {
        await r.card("Chapter 6", "Your admin console", ["Platform-admin only: the legal switches, the income-limit table, and the audit log."]);
        await r.goto("/admin/gates");
        await r.say("Gates & fees. The fee structure stays at none: the rules do not say how a platform fee on a 25F gift is treated.");
        await r.show(r.page.getByRole("heading", { name: "Change the fee structure" }), 120);
        await r.say("Choosing another structure is refused without counsel's memo reference and date — and every change is audited.");
        await r.scrollBy(500);
        await r.say("Live gifts stay off: only sandbox gifts are possible until you turn them on, after the credit date and the memo.");
        await r.goto("/admin/income-limits");
        await r.say("The income-limit table every decision uses: HUD FY 2026, provisional, 254 Texas counties. Swapping in the IRS table is one ingest job.");
        await r.page.getByLabel("County").selectOption({ label: "Starr County (48427)" });
        await r.page.getByRole("button", { name: "Show limits" }).click();
        await r.page.waitForLoadState("networkidle").catch(() => undefined);
        await r.show(r.page.getByRole("heading", { name: "County lookup" }), 90);
        await r.say("Look up any county: both readings for household sizes 1 to 8. Where they differ, incomes in between go to a person.");
        await r.goto("/admin/audit");
        await r.say("The audit log: every read of sensitive data and every change, newest first, never edited or deleted.");
      },
    },
    {
      id: 7,
      title: "What is real, what is next",
      run: async (r) => {
        await r.card("Chapter 7", "What is real versus sandbox", [
          "Real: the income engine for all 254 counties, decisions, review, evidence packs, the API, webhooks, the dashboards.",
          "Sandbox stand-ins: payments (no money moves), the payroll/bank rail, email (outbox), the SGO list (fictional).",
          "Every limit is labeled provisional until the IRS publishes its table.",
        ]);
        await r.card("Only you can supply", "Outside accounts and sign-offs", [
          "A Stripe account (on the parent's entity) and a data-rail contract (Plaid, Argyle, Pinwheel or Truv).",
          "Counsel's memos: the fee structure and the FCRA posture.",
          "IRS SGO portal registration (by each SGO), a domain, and an email sender.",
        ]);
        await r.card("Run it yourself", "Three commands", [
          "npm install  ·  npm run db:seed  ·  npm run dev",
          "Then open localhost:3000 — /sgo, /give, /demo/camp, /admin, /docs.",
          "Sign-in codes appear at /dev/mail. See README.md and docs/how-it-works.md.",
        ]);
      },
    },
  ];
}

/* ------------------------------------------------------------------------------------------------ video */

function ffprobeDuration(ffprobe: string, file: string): number {
  const out = execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  return Math.round(Number(out.trim()) * 1000);
}

function encodeSegment(ffmpeg: string, input: string, output: string): void {
  const vf = `fps=30,scale=${DESKTOP.width}:${DESKTOP.height}:force_original_aspect_ratio=decrease,pad=${DESKTOP.width}:${DESKTOP.height}:(ow-iw)/2:(oh-ih)/2:color=0x08212A,format=yuv420p`;
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", input, "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-an", output]);
}

function findTool(explicit: string | undefined, name: string, preferred: string): string {
  if (explicit) return explicit;
  if (existsSync(preferred)) return preferred;
  return name;
}

/* ------------------------------------------------------------------------------------------------ main */

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "base-url": { type: "string", default: process.env.APP_URL ?? "http://localhost:3000" },
      "data-dir": { type: "string", default: process.env.ECCA_DATA_DIR ?? ".data" },
      out: { type: "string", default: join("docs", "demo") },
      chapters: { type: "string" },
      keep: { type: "boolean", default: false },
      ffmpeg: { type: "string" },
    },
  });
  const base = values["base-url"]!.replace(/\/$/, "");
  const outDir = resolve(values.out!);
  const ffmpeg = findTool(values.ffmpeg, "ffmpeg", "/usr/bin/ffmpeg");
  const ffprobe = findTool(values.ffmpeg ? values.ffmpeg.replace(/ffmpeg$/, "ffprobe") : undefined, "ffprobe", "/usr/bin/ffprobe");

  const health = await fetch(`${base}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error(`The app is not answering at ${base}. Start the seeded dev server first (see the header of this file).`);
  const creds = readDemoCredentials(values["data-dir"]!);
  if (!creds) throw new Error(`No demo credentials in ${values["data-dir"]}. Run the seed against that data directory first.`);

  const wanted = values.chapters ? new Set(values.chapters.split(",").map((s) => Number(s.trim()))) : null;
  const work = join(tmpdir(), `passport-demo-${Date.now().toString(36)}`);
  mkdirSync(work, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const listener = await startDemoWebhookListener();

  const browser = await chromium.launch();
  const ctx: Ctx = { base, creds, browser, sessions: new Map() };
  const specs = chapters(ctx).filter((c) => !wanted || wanted.has(c.id));
  const entries: TimelineEntry[] = [];
  const segments: Array<{ id: number; file: string; ms: number }> = [];
  try {
    for (const spec of specs) {
      console.log(`Recording chapter ${spec.id}: ${spec.title}`);
      const state =
        spec.id === 3 ? await session(ctx, DEMO_LOGINS.sgoOwner) : spec.id === 6 ? await session(ctx, DEMO_LOGINS.admin) : undefined;
      const r = new Recorder(spec.id, spec.phone === true, base);
      await r.open(browser, join(work, `raw-${spec.id}`), state);
      try {
        await spec.run(r);
        await r.pause(600);
      } catch (e) {
        await r.page.screenshot({ path: join(work, `failed-chapter-${spec.id}.png`) }).catch(() => undefined);
        console.error(`Chapter ${spec.id} failed at ${r.page.url()} (screenshot in ${work})`);
        throw e;
      }
      const raw = await r.close();
      const seg = join(work, `seg-${spec.id}.mp4`);
      encodeSegment(ffmpeg, raw, seg);
      segments.push({ id: spec.id, file: seg, ms: ffprobeDuration(ffprobe, seg) });
      entries.push(...r.entries);
    }
  } finally {
    await browser.close();
    listener?.close();
  }

  const list = join(work, "segments.txt");
  writeFileSync(list, segments.map((s) => `file '${s.file.replace(/'/g, "'\\''")}'`).join("\n"));
  const video = join(outDir, "passport-walkthrough.mp4");
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", video]);

  const starts = new Map<number, number>();
  let t = 0;
  for (const s of segments) {
    starts.set(s.id, t);
    t += s.ms;
  }
  const total = ffprobeDuration(ffprobe, video);
  const script = renderScript(chapters(ctx).map(({ id, title }) => ({ id, title })), entries, starts, total, new Date().toISOString().slice(0, 10));
  writeFileSync(join(outDir, "walkthrough-script.md"), script);
  if (!values.keep) rmSync(work, { recursive: true, force: true });
  console.log(`Wrote ${video} (${clock(total)}) and ${join(outDir, "walkthrough-script.md")}${values.keep ? `; raw recordings in ${work}` : ""}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/record-demo.ts")) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
