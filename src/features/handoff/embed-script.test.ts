import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { HANDOFF_EMBED_CONTRACT } from "@/server/api";
import { HANDOFF_EMBED_PATH } from "@/server/handoffs";
import { DOM_EVENTS } from "./messages";
import { EMBED_SCRIPT_PATH, PUBLIC_CREATE_PATH } from "./policy";

/**
 * public/embed/handoff.js runs on businesses' booking pages, so it is tested as it ships: the file is executed in an
 * isolated context against a small DOM double. Keys, bookings and hosts are synthetic.
 */

const SOURCE = readFileSync(join(process.cwd(), "public/embed/handoff.js"), "utf8");
const APP = "https://passport.synthetic-example.org";
const HOST = "https://camp.synthetic-example.org";
const KEY = "pk_test_" + "a".repeat(32);

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  type: string;
  detail?: unknown;
  bubbles?: boolean;
  [k: string]: unknown;
}

class FakeNode {
  nodeName: string;
  attributes = new Map<string, string>();
  style: Record<string, string> = {};
  children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  listeners = new Map<string, Listener[]>();
  textContent = "";
  type = "";
  disabled = false;
  src = "";
  title = "";
  id = "";
  contentWindow: object | null = null;
  ownerDocument: FakeDocument;
  constructor(nodeName: string, doc: FakeDocument) {
    this.nodeName = nodeName.toUpperCase();
    this.ownerDocument = doc;
  }
  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }
  get nextSibling(): FakeNode | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
    if (name === "id") this.id = String(value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  private adopt(child: FakeNode): void {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    if (child.nodeName === "IFRAME") child.contentWindow = { frameOf: child };
  }
  appendChild(child: FakeNode): FakeNode {
    this.adopt(child);
    this.children.push(child);
    return child;
  }
  insertBefore(child: FakeNode, before: FakeNode | null): FakeNode {
    this.adopt(child);
    const index = before ? this.children.indexOf(before) : -1;
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }
  removeChild(child: FakeNode): FakeNode {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  dispatchEvent(event: FakeEvent): boolean {
    for (const fn of this.listeners.get(event.type) ?? []) fn(event);
    if (event.bubbles && this.parentNode) this.parentNode.dispatchEvent(event);
    return true;
  }
  click(): void {
    if (!this.disabled) this.dispatchEvent({ type: "click" });
  }
  find(pred: (n: FakeNode) => boolean): FakeNode | null {
    for (const c of this.children) {
      if (pred(c)) return c;
      const deep = c.find(pred);
      if (deep) return deep;
    }
    return null;
  }
}

class FakeDocument {
  readyState = "complete";
  root: FakeNode;
  body: FakeNode;
  head: FakeNode;
  currentScript: FakeNode | null = null;
  defaultView: FakeWindow | null = null;
  docListeners = new Map<string, Array<() => void>>();
  constructor() {
    this.root = new FakeNode("html", this);
    this.head = this.root.appendChild(new FakeNode("head", this));
    this.body = this.root.appendChild(new FakeNode("body", this));
  }
  createElement(name: string): FakeNode {
    return new FakeNode(name, this);
  }
  getElementById(id: string): FakeNode | null {
    return this.root.find((n) => n.id === id);
  }
  querySelectorAll(): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (n: FakeNode) => {
      if (n.nodeName === "SCRIPT" && n.src.includes("/embed/handoff.js")) out.push(n);
      n.children.forEach(walk);
    };
    walk(this.root);
    return out;
  }
  addEventListener(type: string, fn: () => void): void {
    this.docListeners.set(type, [...(this.docListeners.get(type) ?? []), fn]);
  }
  fire(type: string): void {
    for (const fn of this.docListeners.get(type) ?? []) fn();
  }
  createEvent(): FakeEvent {
    const ev: FakeEvent = { type: "" };
    ev.initCustomEvent = (type: string, bubbles: boolean, _c: boolean, detail: unknown) => Object.assign(ev, { type, bubbles, detail });
    return ev;
  }
}

interface FakeWindow {
  location: { origin: string; assign: ReturnType<typeof vi.fn> };
  fetch?: ReturnType<typeof vi.fn>;
  console: { error: ReturnType<typeof vi.fn> };
  CustomEvent: new (type: string, init: { detail?: unknown; bubbles?: boolean }) => FakeEvent;
  messageListeners: Array<(e: unknown) => void>;
  addEventListener(type: string, fn: (e: unknown) => void): void;
}

interface Setup {
  doc: FakeDocument;
  win: FakeWindow;
  script: FakeNode;
  events: FakeEvent[];
}

function setup(attrs: Record<string, string>, opts: { fetch?: ReturnType<typeof vi.fn>; noCurrentScript?: boolean; loading?: boolean; inHead?: boolean; target?: string } = {}): Setup {
  const doc = new FakeDocument();
  const win: FakeWindow = {
    location: { origin: HOST, assign: vi.fn() },
    fetch: opts.fetch,
    console: { error: vi.fn() },
    CustomEvent: class {
      type: string;
      detail: unknown;
      bubbles: boolean;
      constructor(type: string, init: { detail?: unknown; bubbles?: boolean }) {
        this.type = type;
        this.detail = init.detail;
        this.bubbles = init.bubbles ?? false;
      }
    } as unknown as FakeWindow["CustomEvent"],
    messageListeners: [],
    addEventListener(type, fn) {
      if (type === "message") this.messageListeners.push(fn);
    },
  };
  doc.defaultView = win;
  if (opts.loading) doc.readyState = "loading";
  const script = doc.createElement("script");
  script.src = `${APP}/embed/handoff.js`;
  for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v);
  (opts.inHead ? doc.head : doc.body).appendChild(script);
  if (opts.target && !opts.loading) {
    const t = doc.createElement("div");
    t.setAttribute("id", opts.target);
    doc.body.appendChild(t);
  }
  doc.currentScript = opts.noCurrentScript ? null : script;
  const events: FakeEvent[] = [];
  for (const name of Object.values(DOM_EVENTS)) doc.root.addEventListener(name, (e) => events.push(e));
  runInNewContext(SOURCE, { document: doc, window: win, console: win.console });
  return { doc, win, script, events };
}

const BASE = { "data-publishable-key": KEY, "data-booking-ref": "SYN-BK-1", "data-booking-description": "Session 2 (synthetic)", "data-booking-amount-cents": "45000", "data-return-url": `${HOST}/booking/SYN-BK-1` };

function ok(json: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(json) });
}
const SESSION = { object: "handoff_session", handoff_id: "hof_synthetic1", status: "started", hold_expires_at: "2026-11-21T16:00:00.000Z", url: `${APP}/h/tok`, embed_url: `${APP}/embed/handoff/tok` };

const flush = () => new Promise((r) => setTimeout(r, 0));
const buttonOf = (s: Setup) => s.doc.root.find((n) => n.nodeName === "BUTTON")!;

describe("public/embed/handoff.js", () => {
  it("renders the button right after the script tag, once", () => {
    const s = setup(BASE);
    const container = s.script.nextSibling!;
    expect(container.getAttribute("data-passport-handoff")).toBe("SYN-BK-1");
    expect(buttonOf(s).textContent).toBe("Pay with a scholarship");
    expect(buttonOf(s).type).toBe("button");
    expect(s.script.getAttribute("data-passport-mounted")).toBe("true");
    // Running the script again (a second copy on the page) does not mount twice.
    runInNewContext(SOURCE, { document: s.doc, window: s.win, console: s.win.console });
    expect(s.doc.body.children.filter((c) => c.getAttribute("data-passport-handoff")).length).toBe(1);
  });

  it("speaks Spanish with data-locale=es", () => {
    const s = setup({ ...BASE, "data-locale": "es" });
    expect(buttonOf(s).textContent).toBe("Pagar con una beca");
  });

  it.each([
    ["a missing key", { "data-publishable-key": "" }],
    ["a secret key in place of the publishable key", { "data-publishable-key": "ecca_test_" + "a".repeat(32) }],
    ["a malformed publishable key", { "data-publishable-key": "pk_test_short" }],
    ["a missing booking reference", { "data-booking-ref": "" }],
    ["a fractional cents amount", { "data-booking-amount-cents": "450.00" }],
    ["a zero amount", { "data-booking-amount-cents": "0" }],
    ["a negative dollar amount", { "data-booking-amount-cents": "", "data-amount": "-5" }],
  ])("renders nothing and logs for %s", (_label, override) => {
    const s = setup({ ...BASE, ...override });
    expect(s.doc.root.find((n) => n.nodeName === "BUTTON")).toBeNull();
    expect(s.win.console.error).toHaveBeenCalledTimes(1);
  });

  it("posts the booking to its own host as a simple text/plain request with no credentials", async () => {
    const fetch = ok(SESSION);
    const s = setup(BASE, { fetch });
    buttonOf(s).click();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${APP}${PUBLIC_CREATE_PATH}`);
    expect(init).toMatchObject({ method: "POST", credentials: "omit", headers: { "Content-Type": "text/plain;charset=UTF-8" } });
    expect(JSON.parse(init.body)).toEqual({
      publishable_key: KEY,
      booking_ref: "SYN-BK-1",
      booking_description: "Session 2 (synthetic)",
      booking_amount_cents: 45000,
      return_url: `${HOST}/booking/SYN-BK-1`,
      channel: "redirect",
      locale: "en",
    });
  });

  it("accepts the short aliases, with data-amount in dollars", async () => {
    const fetch = ok(SESSION);
    const s = setup({ "data-key": KEY, "data-booking-ref": "SYN-BK-2", "data-description": "Week 3", "data-amount": "1,250.5" }, { fetch });
    buttonOf(s).click();
    await flush();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ publishable_key: KEY, booking_description: "Week 3", booking_amount_cents: 125050 });
  });

  it("omits optional fields that were not given", async () => {
    const fetch = ok(SESSION);
    const s = setup({ "data-publishable-key": KEY, "data-booking-ref": "SYN-BK-3" }, { fetch });
    buttonOf(s).click();
    await flush();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ publishable_key: KEY, booking_ref: "SYN-BK-3", channel: "redirect", locale: "en" });
  });

  it("button mode: emits handoff.created in both event forms, then sends the family to the hosted page", async () => {
    const s = setup(BASE, { fetch: ok(SESSION) });
    buttonOf(s).click();
    await flush();
    expect(s.win.location.assign).toHaveBeenCalledWith(SESSION.url);
    const created = s.events.find((e) => e.type === DOM_EVENTS.created)!;
    expect(created.detail).toEqual({ handoff_id: "hof_synthetic1", status: "started", hold_expires_at: SESSION.hold_expires_at });
    const generic = s.events.find((e) => e.type === DOM_EVENTS.any)!;
    expect(generic.detail).toEqual({ type: "handoff.created", handoff_id: "hof_synthetic1", status: "started", hold_expires_at: SESSION.hold_expires_at });
    // The token-bearing URL never reaches the host page's events.
    expect(JSON.stringify(s.events.map((e) => e.detail))).not.toContain("/h/tok");
  });

  it("a second click re-opens the same handoff instead of creating another", async () => {
    const fetch = ok(SESSION);
    const s = setup(BASE, { fetch });
    buttonOf(s).click();
    await flush();
    buttonOf(s).click();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(s.win.location.assign).toHaveBeenCalledTimes(2);
  });

  it("ignores clicks while a request is in flight", async () => {
    let resolve: (v: unknown) => void = () => {};
    const fetch = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    const s = setup(BASE, { fetch });
    const b = buttonOf(s);
    b.click();
    b.disabled = false; // even if a page script re-enables it
    b.click();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(b.textContent).toBe("Starting…");
    resolve({ ok: true, json: () => Promise.resolve(SESSION) });
    await flush();
    await flush();
    expect(s.win.location.assign).toHaveBeenCalledTimes(1);
  });

  it("shows an error, emits handoff.error and lets the family retry when the server refuses", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: { code: "forbidden", message: "This page is not allowed to start a scholarship check." } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(SESSION) });
    const s = setup(BASE, { fetch });
    buttonOf(s).click();
    await flush();
    await flush();
    const alert = s.doc.root.find((n) => n.getAttribute("role") === "alert")!;
    expect(alert.style.display).toBe("block");
    expect(alert.textContent).toContain("couldn't start");
    expect(s.events.find((e) => e.type === DOM_EVENTS.error)?.detail).toEqual({ code: "forbidden", message: "This page is not allowed to start a scholarship check." });
    expect(buttonOf(s).disabled).toBe(false);
    expect(s.win.location.assign).not.toHaveBeenCalled();
    buttonOf(s).click();
    await flush();
    await flush();
    expect(s.win.location.assign).toHaveBeenCalledWith(SESSION.url);
  });

  it("reports a network failure", async () => {
    const s = setup(BASE, { fetch: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    buttonOf(s).click();
    await flush();
    await flush();
    expect(s.events.find((e) => e.type === DOM_EVENTS.error)?.detail).toMatchObject({ code: "network" });
  });

  it("reports a body that is not JSON", async () => {
    const s = setup(BASE, { fetch: vi.fn().mockResolvedValue({ ok: false, json: () => Promise.reject(new SyntaxError("bad")) }) });
    buttonOf(s).click();
    await flush();
    await flush();
    expect(s.events.find((e) => e.type === DOM_EVENTS.error)?.detail).toMatchObject({ code: "internal" });
  });

  it("never opens a URL on another host, whatever the response says", async () => {
    const s = setup(BASE, { fetch: ok({ ...SESSION, url: "https://evil.example/h/tok" }) });
    buttonOf(s).click();
    await flush();
    await flush();
    expect(s.win.location.assign).not.toHaveBeenCalled();
    expect(s.events.some((e) => e.type === DOM_EVENTS.created)).toBe(false);
    expect(s.events.find((e) => e.type === DOM_EVENTS.error)).toBeDefined();
  });

  it("logs and shows the error when fetch is unavailable", async () => {
    const s = setup(BASE);
    buttonOf(s).click();
    await flush();
    expect(s.events.find((e) => e.type === DOM_EVENTS.error)?.detail).toMatchObject({ code: "unsupported" });
  });

  describe("inline mode", () => {
    async function inline(extra: Record<string, string> = {}) {
      const s = setup({ ...BASE, "data-mode": "inline", ...extra }, { fetch: ok(SESSION) });
      buttonOf(s).click();
      await flush();
      await flush();
      const frame = s.doc.root.find((n) => n.nodeName === "IFRAME")!;
      const post = (data: unknown, origin = APP, source: unknown = frame.contentWindow) => s.win.messageListeners.forEach((fn) => fn({ origin, source, data }));
      return { ...s, frame, post };
    }

    it("replaces the button with a frame told this page's origin, and asks for the embed channel", async () => {
      const s = await inline({ "data-locale": "es" });
      expect(s.frame.src).toBe(`${SESSION.embed_url}?parent_origin=${encodeURIComponent(HOST)}&lang=es`);
      expect(s.frame.style.height).toBe("560px");
      expect(s.doc.root.find((n) => n.nodeName === "BUTTON")).toBeNull();
      expect(s.win.location.assign).not.toHaveBeenCalled();
      expect(JSON.parse(s.win.fetch!.mock.calls[0][1].body).channel).toBe("embed");
    });

    it("resizes only on messages from its host and its own frame, within bounds", async () => {
      const s = await inline();
      s.post({ source: "ecca-embed", type: "resize", height: 812 });
      expect(s.frame.style.height).toBe("812px");
      s.post({ source: "ecca-embed", type: "resize", height: 999 }, "https://evil.example");
      s.post({ source: "ecca-embed", type: "resize", height: 999 }, APP, { other: true });
      s.post({ source: "other", type: "resize", height: 999 });
      s.post("not an object");
      expect(s.frame.style.height).toBe("812px");
      s.post({ source: "ecca-embed", type: "resize", height: 10 });
      expect(s.frame.style.height).toBe("200px");
      s.post({ source: "ecca-embed", type: "resize", height: 1e9 });
      expect(s.frame.style.height).toBe("20000px");
    });

    it("turns status and closed messages for this handoff into DOM events", async () => {
      const s = await inline();
      s.post({ source: "ecca-embed", type: "handoff.status", handoff_id: "hof_synthetic1", status: "held", hold_expires_at: SESSION.hold_expires_at });
      s.post({ source: "ecca-embed", type: "handoff.status", handoff_id: "hof_someone_else", status: "eligible" });
      s.post({ source: "ecca-embed", type: "handoff.closed", handoff_id: "hof_synthetic1", status: "held" });
      expect(s.events.filter((e) => e.type === DOM_EVENTS.status).map((e) => e.detail)).toEqual([{ handoff_id: "hof_synthetic1", status: "held", hold_expires_at: SESSION.hold_expires_at }]);
      expect(s.events.find((e) => e.type === DOM_EVENTS.closed)?.detail).toEqual({ handoff_id: "hof_synthetic1", status: "held" });
      expect(s.events.filter((e) => e.type === DOM_EVENTS.any).map((e) => (e.detail as { type: string }).type)).toEqual(["handoff.created", "handoff.status", "handoff.closed"]);
    });
  });

  describe("placement", () => {
    it("renders into data-target when it exists", () => {
      const s = setup({ ...BASE, "data-target": "pay-here" }, { target: "pay-here" });
      expect(s.doc.getElementById("pay-here")!.children[0].getAttribute("data-passport-handoff")).toBe("SYN-BK-1");
    });

    it("waits for the document when the target is not parsed yet", () => {
      const s = setup({ ...BASE, "data-target": "late" }, { loading: true, inHead: true });
      expect(s.doc.root.find((n) => n.getAttribute("data-passport-handoff") !== null)).toBeNull();
      const t = s.doc.createElement("div");
      t.setAttribute("id", "late");
      s.doc.body.appendChild(t);
      s.doc.fire("DOMContentLoaded");
      expect(t.children[0].getAttribute("data-passport-handoff")).toBe("SYN-BK-1");
    });

    it("never renders inside <head> (a framework may hoist the script tag there)", () => {
      const s = setup(BASE, { inHead: true });
      expect(s.doc.head.children.some((c) => c.getAttribute("data-passport-handoff"))).toBe(false);
      expect(s.doc.body.children.some((c) => c.getAttribute("data-passport-handoff"))).toBe(true);
    });

    it("mounts every not-yet-mounted handoff script when currentScript is unavailable", () => {
      const s = setup(BASE, { noCurrentScript: true });
      expect(s.script.getAttribute("data-passport-mounted")).toBe("true");
      expect(buttonOf(s)).not.toBeNull();
    });
  });

  describe("contract (HANDOFF_EMBED_CONTRACT, rendered on /docs)", () => {
    it("lives at the documented paths", () => {
      expect(EMBED_SCRIPT_PATH).toBe(HANDOFF_EMBED_CONTRACT.scriptPath);
      expect(HANDOFF_EMBED_CONTRACT.framePath).toBe(HANDOFF_EMBED_PATH);
      expect(SOURCE).toContain(`"${HANDOFF_EMBED_CONTRACT.scriptPath}"`);
      expect(SOURCE).toContain(`"${PUBLIC_CREATE_PATH}"`);
    });

    it("reads every documented attribute and dispatches the documented event", () => {
      for (const a of HANDOFF_EMBED_CONTRACT.attributes) expect(SOURCE).toContain(`"${a.name}"`);
      expect(DOM_EVENTS.any).toBe(HANDOFF_EMBED_CONTRACT.domEvent);
      expect(SOURCE).toContain(`"${HANDOFF_EMBED_CONTRACT.messageSource}"`);
      for (const e of HANDOFF_EMBED_CONTRACT.events.filter((x) => x.type !== "resize")) expect(SOURCE).toMatch(new RegExp(`"${e.type.replace("handoff.", "")}"|handoff\\.`));
    });
  });
});
