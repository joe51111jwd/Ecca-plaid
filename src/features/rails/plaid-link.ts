/**
 * Loads Plaid Link's web script on demand (only when Plaid is the rail and the family chose to connect) and
 * turns its callbacks into the client result `completeConnection` expects. Plaid documents the script tag
 * and `Plaid.create({ token, onSuccess, onExit }).open()` in "Add Income to your app".
 */

export const PLAID_LINK_SCRIPT_URL = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
/** Policy: how long to wait for the script before telling the family it could not load. */
export const PLAID_LINK_LOAD_TIMEOUT_MS = 15_000;

export interface PlaidLinkError {
  error_type?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  display_message?: string | null;
}

export interface PlaidLinkExitMetadata {
  status?: string | null;
  link_session_id?: string | null;
}

export interface PlaidLinkHandler {
  open(): void;
  destroy?(): void;
}

export interface PlaidLinkConfig {
  token: string;
  onSuccess: (publicToken: string, metadata: unknown) => void;
  onExit: (error: PlaidLinkError | null, metadata: PlaidLinkExitMetadata | null) => void;
}

export interface PlaidGlobal {
  create(config: PlaidLinkConfig): PlaidLinkHandler;
}

/** The parts of the browser the loader touches; injectable for tests. */
export interface LinkLoaderEnv {
  document: { createElement(tag: "script"): HTMLScriptElement; head: { appendChild(node: HTMLScriptElement): unknown }; querySelector(selector: string): Element | null };
  window: { Plaid?: PlaidGlobal; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
}

let pending: Promise<PlaidGlobal> | null = null;

/** Tests only: forget the memoized load. */
export function resetPlaidLinkLoaderForTests(): void {
  pending = null;
}

function browserEnv(): LinkLoaderEnv {
  return {
    document,
    window: window as unknown as LinkLoaderEnv["window"],
  };
}

/** Resolves with `window.Plaid`, adding the script tag once. A failed load can be retried. */
export function loadPlaidLink(env: LinkLoaderEnv = browserEnv()): Promise<PlaidGlobal> {
  if (env.window.Plaid) return Promise.resolve(env.window.Plaid);
  if (pending) return pending;
  pending = new Promise<PlaidGlobal>((resolve, reject) => {
    const fail = (why: string) => {
      pending = null;
      reject(new Error(why));
    };
    const timer = env.window.setTimeout(() => fail("Plaid Link did not load in time"), PLAID_LINK_LOAD_TIMEOUT_MS);
    const done = () => {
      env.window.clearTimeout(timer);
      if (env.window.Plaid) resolve(env.window.Plaid);
      else fail("Plaid Link loaded without defining Plaid");
    };
    const existing = env.document.querySelector(`script[src="${PLAID_LINK_SCRIPT_URL}"]`) as HTMLScriptElement | null;
    const script = existing ?? env.document.createElement("script");
    script.addEventListener("load", done, { once: true });
    script.addEventListener(
      "error",
      () => {
        env.window.clearTimeout(timer);
        fail("Plaid Link could not be loaded");
      },
      { once: true },
    );
    if (!existing) {
      script.src = PLAID_LINK_SCRIPT_URL;
      script.async = true;
      env.document.head.appendChild(script);
    }
  });
  return pending;
}

/** What `completeConnection` expects after Link's onSuccess. The public token goes to our server, never stored client-side. */
export function plaidSuccessResult(publicToken: string): { status: "success"; publicToken: string } {
  return { status: "success", publicToken };
}

/** What `completeConnection` expects after Link's onExit: no error means the person chose to leave (a decline). */
export function plaidExitResult(error: PlaidLinkError | null, metadata: PlaidLinkExitMetadata | null): { status: "exit"; errorCode: string | null; exitStatus: string | null } {
  return { status: "exit", errorCode: error?.error_code ?? null, exitStatus: metadata?.status ?? null };
}
