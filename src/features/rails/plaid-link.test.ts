import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPlaidLink, PLAID_LINK_LOAD_TIMEOUT_MS, PLAID_LINK_SCRIPT_URL, plaidExitResult, plaidSuccessResult, resetPlaidLinkLoaderForTests, type LinkLoaderEnv, type PlaidGlobal } from "./plaid-link";

class FakeScript {
  src = "";
  async = false;
  removed = false;
  private listeners: Record<string, Array<() => void>> = {};
  remove() {
    this.removed = true;
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  fire(type: "load" | "error") {
    for (const fn of this.listeners[type] ?? []) fn();
  }
}

function fakeEnv() {
  const appended: FakeScript[] = [];
  const timers: Array<() => void> = [];
  const win: LinkLoaderEnv["window"] = {
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: vi.fn(),
  };
  const env: LinkLoaderEnv = {
    document: {
      createElement: () => new FakeScript() as unknown as HTMLScriptElement,
      head: { appendChild: (node: HTMLScriptElement) => appended.push(node as unknown as FakeScript) },
      // Like the real DOM: a script tag stays in the page until removed.
      querySelector: () => (appended.find((s) => !s.removed) as unknown as Element | undefined) ?? null,
    },
    window: win,
  };
  return { env, appended, timers, win };
}

const fakePlaid: PlaidGlobal = { create: () => ({ open: () => undefined }) };

describe("loadPlaidLink", () => {
  afterEach(() => resetPlaidLinkLoaderForTests());

  it("adds the documented script once, asynchronously, and resolves with window.Plaid", async () => {
    const { env, appended, win } = fakeEnv();
    const a = loadPlaidLink(env);
    const b = loadPlaidLink(env);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ src: PLAID_LINK_SCRIPT_URL, async: true });
    win.Plaid = fakePlaid;
    appended[0]!.fire("load");
    await expect(a).resolves.toBe(fakePlaid);
    await expect(b).resolves.toBe(fakePlaid);
    expect(win.clearTimeout).toHaveBeenCalled();
  });

  it("does not load anything when Plaid is already present", async () => {
    const { env, appended, win } = fakeEnv();
    win.Plaid = fakePlaid;
    await expect(loadPlaidLink(env)).resolves.toBe(fakePlaid);
    expect(appended).toHaveLength(0);
  });

  it("rejects on a load error and allows a retry", async () => {
    const { env, appended } = fakeEnv();
    const first = loadPlaidLink(env);
    appended[0]!.fire("error");
    await expect(first).rejects.toThrow(/could not be loaded/);
    expect(appended[0]!.removed).toBe(true);
    const second = loadPlaidLink(env);
    expect(appended).toHaveLength(2);
    expect(appended[1]).toMatchObject({ src: PLAID_LINK_SCRIPT_URL, removed: false });
    env.window.Plaid = fakePlaid;
    appended[1]!.fire("load");
    await expect(second).resolves.toBe(fakePlaid);
  });

  it("reuses a script tag already in the page that is still loading", async () => {
    const { env, appended } = fakeEnv();
    const first = loadPlaidLink(env);
    resetPlaidLinkLoaderForTests();
    const again = loadPlaidLink(env);
    expect(appended).toHaveLength(1);
    env.window.Plaid = fakePlaid;
    appended[0]!.fire("load");
    await expect(first).resolves.toBe(fakePlaid);
    await expect(again).resolves.toBe(fakePlaid);
  });

  it("rejects after the timeout, and when the script defines nothing", async () => {
    const { env, timers } = fakeEnv();
    const p = loadPlaidLink(env);
    expect(PLAID_LINK_LOAD_TIMEOUT_MS).toBeGreaterThan(0);
    timers[0]!();
    await expect(p).rejects.toThrow(/did not load in time/);
    resetPlaidLinkLoaderForTests();
    const second = fakeEnv();
    const q = loadPlaidLink(second.env);
    second.appended[0]!.fire("load");
    await expect(q).rejects.toThrow(/without defining Plaid/);
  });
});

describe("Link callback results", () => {
  it("passes the public token to the server and maps exits", () => {
    expect(plaidSuccessResult("public-sandbox-x")).toEqual({ status: "success", publicToken: "public-sandbox-x" });
    expect(plaidExitResult(null, { status: "requires_credentials" })).toEqual({ status: "exit", errorCode: null, exitStatus: "requires_credentials" });
    expect(plaidExitResult({ error_code: "INVALID_LINK_TOKEN" }, null)).toEqual({ status: "exit", errorCode: "INVALID_LINK_TOKEN", exitStatus: null });
  });
});
