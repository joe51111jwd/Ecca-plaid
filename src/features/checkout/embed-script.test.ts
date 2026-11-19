import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * public/embed/donate.js runs on other organizations' pages, so it is tested as it ships: the file is executed in an
 * isolated context against a minimal DOM double.
 */

const SOURCE = readFileSync(join(process.cwd(), "public/embed/donate.js"), "utf8");
const APP = "https://give.example.org";

interface FakeElement {
  tagName: string;
  attributes: Map<string, string>;
  style: Record<string, string>;
  children: FakeElement[];
  src: string;
  title: string;
  contentWindow: object | null;
  parentNode: FakeElement | null;
  nextSibling: FakeElement | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  appendChild(child: FakeElement): void;
  insertBefore(child: FakeElement, before: FakeElement | null): void;
}

function element(tagName: string): FakeElement {
  const el: FakeElement = {
    tagName,
    attributes: new Map(),
    style: {},
    children: [],
    src: "",
    title: "",
    contentWindow: null,
    parentNode: null,
    nextSibling: null,
    getAttribute: (name) => el.attributes.get(name) ?? null,
    setAttribute: (name, value) => {
      el.attributes.set(name, String(value));
    },
    appendChild: (child) => {
      child.parentNode = el;
      if (child.tagName === "IFRAME") child.contentWindow = { frameOf: child };
      el.children.push(child);
    },
    insertBefore: (child, before) => {
      child.parentNode = el;
      if (child.tagName === "IFRAME") child.contentWindow = { frameOf: child };
      const index = before ? el.children.indexOf(before) : -1;
      if (index === -1) el.children.push(child);
      else el.children.splice(index, 0, child);
    },
  };
  return el;
}

function page(options: { attrs?: Record<string, string>; src?: string; currentScript?: boolean; targets?: string[] } = {}) {
  const listeners: Array<(event: { origin: string; source: unknown; data: unknown }) => void> = [];
  const errors: string[] = [];
  const body = element("BODY");
  const script = element("SCRIPT");
  script.src = options.src ?? `${APP}/embed/donate.js`;
  for (const [k, v] of Object.entries(options.attrs ?? { "data-sgo": "lone-star-fund" })) script.setAttribute(k, v);
  body.appendChild(script);
  const targets = new Map((options.targets ?? []).map((id) => [id, element("DIV")]));
  const win = {
    addEventListener: (type: string, fn: (event: { origin: string; source: unknown; data: unknown }) => void) => {
      if (type === "message") listeners.push(fn);
    },
    console: { error: (msg: string) => errors.push(msg) },
  };
  const doc = {
    currentScript: options.currentScript === false ? null : script,
    defaultView: win,
    createElement: (tag: string) => element(tag.toUpperCase()),
    getElementById: (id: string) => targets.get(id) ?? null,
    querySelectorAll: () => [script],
  };
  (script as unknown as { ownerDocument: unknown }).ownerDocument = doc;
  const run = () => runInNewContext(SOURCE, { document: doc, window: win, encodeURIComponent, parseInt, isFinite, Math, String });
  const frames = () => [...body.children, ...[...targets.values()].flatMap((t) => t.children)].filter((c) => c.tagName === "IFRAME");
  const post = (event: { origin: string; source: unknown; data: unknown }) => listeners.forEach((fn) => fn(event));
  return { run, frames, post, errors, listeners, targets, script };
}

describe("public/embed/donate.js", () => {
  it("mounts one full-width iframe for the organization right after the script tag, on the script's own host", () => {
    const p = page();
    p.run();
    const [frame] = p.frames();
    expect(p.frames()).toHaveLength(1);
    expect(frame.src).toBe(`${APP}/embed/give/lone-star-fund`);
    expect(frame.style).toMatchObject({ width: "100%", height: "640px", border: "0" });
    expect(frame.getAttribute("allow")).toBe("payment");
    expect(frame.title).toBe("Giving form");
    expect(frame.parentNode?.children.indexOf(frame)).toBe(1);
  });

  it("resizes only on a well-formed message from its own frame and the app's origin", () => {
    const p = page();
    p.run();
    const [frame] = p.frames();
    const ok = { origin: APP, source: frame.contentWindow, data: { source: "ecca-embed", type: "resize", height: 1234 } };
    p.post({ ...ok, origin: "https://evil.example" });
    p.post({ ...ok, source: {} });
    p.post({ ...ok, data: { source: "other", type: "resize", height: 900 } });
    p.post({ ...ok, data: { source: "ecca-embed", type: "resize", height: "900" } });
    p.post({ ...ok, data: null });
    expect(frame.style.height).toBe("640px");
    p.post(ok);
    expect(frame.style.height).toBe("1234px");
  });

  it("clamps absurd heights", () => {
    const p = page();
    p.run();
    const [frame] = p.frames();
    p.post({ origin: APP, source: frame.contentWindow, data: { source: "ecca-embed", type: "resize", height: 10 ** 9 } });
    expect(frame.style.height).toBe("20000px");
    p.post({ origin: APP, source: frame.contentWindow, data: { source: "ecca-embed", type: "resize", height: -5 } });
    expect(frame.style.height).toBe("200px");
    p.post({ origin: APP, source: frame.contentWindow, data: { source: "ecca-embed", type: "resize", height: Number.NaN } });
    expect(frame.style.height).toBe("640px");
  });

  it("refuses a missing or malformed slug and a relative src, without throwing on the host page", () => {
    for (const attrs of [{} as Record<string, string>, { "data-sgo": "../admin" }, { "data-sgo": "a b" }, { "data-sgo": "<x>" }]) {
      const p = page({ attrs });
      p.run();
      expect(p.frames()).toHaveLength(0);
      expect(p.errors).toHaveLength(1);
    }
    const relative = page({ src: "/embed/donate.js" });
    relative.run();
    expect(relative.frames()).toHaveLength(0);
  });

  it("mounts into data-target when that element exists, and honours data-min-height and data-title", () => {
    const p = page({ attrs: { "data-sgo": "lone-star-fund", "data-target": "give-here", "data-min-height": "900", "data-title": "Give to Lone Star" }, targets: ["give-here"] });
    p.run();
    const [frame] = p.targets.get("give-here")!.children;
    expect(frame.style.height).toBe("900px");
    expect(frame.title).toBe("Give to Lone Star");
  });

  it("does not mount twice when the script runs twice, and finds itself without currentScript", () => {
    const p = page({ currentScript: false });
    p.run();
    p.run();
    expect(p.frames()).toHaveLength(1);
    expect(p.listeners).toHaveLength(1);
  });

  it("normalizes the slug and encodes it into the path", () => {
    const p = page({ attrs: { "data-sgo": "  Lone-Star-Fund " } });
    p.run();
    expect(p.frames()[0].src).toBe(`${APP}/embed/give/lone-star-fund`);
    vi.restoreAllMocks();
  });
});
