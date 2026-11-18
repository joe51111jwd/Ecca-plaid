"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";
import { uiStrings, type UiLocale } from "./locale";

export type ToastTone = "neutral" | "success" | "danger";

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Milliseconds before it leaves. 0 keeps it until dismissed. Default 5000 (8000 for danger). */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  /** Show a toast. Returns its id. */
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_ICON: Record<ToastTone, ReactNode> = {
  neutral: <Info className="text-fg-muted" />,
  success: <CircleCheck className="text-success-600" />,
  danger: <CircleAlert className="text-danger-600" />,
};

const MAX_VISIBLE = 4;

/**
 * Hosts toasts for everything beneath it. The root layout already renders one — call `useToast()` anywhere.
 * Toasts confirm something that already happened ("Copied", "Saved"). Anything the person must read or act
 * on belongs in the page (Alert, FormError), not in a toast that disappears.
 */
export function ToastProvider({ children, locale = "en" }: { children: ReactNode; locale?: UiLocale }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const t = uiStrings(locale);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      setToasts((list) => [...list, { ...options, id }].slice(-MAX_VISIBLE));
      const duration = options.duration ?? (options.tone === "danger" ? 8000 : 5000);
      if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div role="region" aria-label={t.notifications} className="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex flex-col items-center gap-2 p-4 sm:items-end">
        {/* Two always-present live regions: polite for confirmations, assertive for failures. */}
        <div aria-live="polite" aria-atomic="false" className="flex w-full max-w-sm flex-col gap-2">
          {toasts
            .filter((item) => item.tone !== "danger")
            .map((item) => (
              <ToastCard key={item.id} toast={item} onDismiss={dismiss} dismissLabel={t.dismiss} />
            ))}
        </div>
        <div aria-live="assertive" aria-atomic="false" className="flex w-full max-w-sm flex-col gap-2">
          {toasts
            .filter((item) => item.tone === "danger")
            .map((item) => (
              <ToastCard key={item.id} toast={item} onDismiss={dismiss} dismissLabel={t.dismiss} />
            ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss, dismissLabel }: { toast: ToastRecord; onDismiss: (id: number) => void; dismissLabel: string }) {
  const tone = toast.tone ?? "neutral";
  return (
    <div className={cn("pointer-events-auto flex animate-rise-in items-start gap-3 rounded-card border border-line bg-surface p-3.5 shadow-lg", tone === "danger" && "border-danger-line")}>
      <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 [&>svg]:size-5">
        {TOAST_ICON[tone]}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-fg">{toast.title}</p>
        {toast.description ? <p className="mt-0.5 text-fg-muted">{toast.description}</p> : null}
      </div>
      <button type="button" aria-label={dismissLabel} onClick={() => onDismiss(toast.id)} className="-m-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-sunken hover:text-fg">
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

/** `const { toast } = useToast(); toast({ title: "Saved", tone: "success" })`. Client components only. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider> (the root layout provides one).");
  return context;
}

export interface FlashToastProps extends ToastOptions {
  /** Changes when a new flash should fire (e.g. a timestamp from the server); the same key never fires twice. */
  flashKey?: string;
}

/**
 * Fires one toast when it mounts. Lets a server page confirm the result of a redirect:
 * `{saved ? <FlashToast title="Settings saved" tone="success" /> : null}`
 */
export function FlashToast({ flashKey, title, description, tone, duration }: FlashToastProps) {
  const { toast } = useToast();
  const fired = useRef<string | null>(null);
  useEffect(() => {
    const key = flashKey ?? "once";
    if (fired.current === key) return;
    fired.current = key;
    toast({ title, description, tone, duration });
    // Only a new flashKey re-fires; the content is read at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashKey, toast]);
  return null;
}
