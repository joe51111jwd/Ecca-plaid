import { notFound } from "next/navigation";

/**
 * The development mailbox shows every outgoing message, sign-in links included, to anyone who can open it.
 * It therefore exists only outside production: every page and route under /dev/mail calls this first.
 * (Checked against process.env.NODE_ENV directly, which Next.js fixes at build time.)
 */
export function assertDevMailboxEnabled(): void {
  if (process.env.NODE_ENV === "production") notFound();
}

/** First value of a search param that may be repeated. */
export function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/**
 * The stored HTML with `<base target="_blank">` added, for display in a sandboxed iframe: links then open
 * in a new tab instead of trying to load the app inside the frame (which the app's own framing policy blocks).
 */
export function previewDocument(html: string): string {
  const base = '<base target="_blank">';
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + base + html.slice(at);
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype ? doctype[0] + base + html.slice(doctype[0].length) : base + html;
}

const timestampFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

export function formatTimestamp(date: Date | null | undefined): string {
  // Newer ICU data separates the time and "PM" with a narrow no-break space; keep the output plain.
  return date ? timestampFormat.format(date).replace(/\s+/g, " ") : "—";
}
