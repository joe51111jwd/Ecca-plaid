import { BRAND } from "@/lib/brand";
import { AppError } from "@/lib/errors";

/** Escapes text for use in HTML content and in double- or single-quoted attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailLocale = "en" | "es";

interface RenderEmailCommon {
  /** Preview line shown by mail clients next to the subject. Hidden in the body. */
  preheader?: string;
  heading: string;
  /** Label/value rows shown as a small table, e.g. the lines of a receipt. Plain text, escaped. */
  details?: Array<{ label: string; value: string }>;
  /** Primary action. Rendered as a button plus the bare link, so it works where buttons do not. */
  cta?: { label: string; url: string };
  /** A short code to read or type, e.g. the 6-digit sign-in code. Shown large, below the button. */
  code?: { label: string; value: string };
  /** Small print under the message, e.g. "If you did not request this, you can ignore this email." */
  footerNote?: string;
  /** Language of the built-in phrases and the `lang` attribute. Default "en". */
  locale?: EmailLocale;
}

export type RenderEmailInput = RenderEmailCommon &
  (
    | {
        /** Plain-text paragraphs. Escaped; line breaks inside a paragraph are kept. */
        paragraphs: string[];
        bodyHtml?: undefined;
      }
    | {
        /**
         * Trusted HTML for the message body, for content that paragraphs cannot express. The caller must
         * escape every interpolated value with escapeHtml(); it is inserted as-is.
         */
        bodyHtml: string;
        paragraphs?: undefined;
      }
  );

export interface RenderedEmail {
  html: string;
  text: string;
}

const PHRASES: Record<EmailLocale, { linkFallback: string; sentBy: (brand: string) => string }> = {
  en: {
    linkFallback: "If the button does not work, copy and paste this link into your browser:",
    sentBy: (brand) => `Sent by ${brand}`,
  },
  es: {
    linkFallback: "Si el botón no funciona, copie y pegue este enlace en su navegador:",
    sentBy: (brand) => `Enviado por ${brand}`,
  },
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const COLOR = { page: "#f4f5f7", card: "#ffffff", border: "#e3e5e8", text: "#1b1f24", muted: "#5b6470", brand: "#1f3a5f", action: "#1f4b99", actionText: "#ffffff", codeBg: "#f4f5f7" } as const;

/** Only http(s) links may appear in an email: no javascript:, data: or relative URLs. Returns the normalized URL. */
function safeHttpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("internal", "Email link must be an absolute http(s) URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new AppError("internal", "Email link must be an absolute http(s) URL");
  return parsed.href;
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function tidyText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain-text rendering of simple HTML: block elements become paragraphs, links keep their URL, tags and entities go. */
export function htmlToText(html: string): string {
  const stripTags = (s: string) => s.replace(/<[^>]*>/g, "");
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, dq: string | undefined, sq: string | undefined, inner: string) => {
      const url = (dq ?? sq ?? "").trim();
      const label = stripTags(inner).trim();
      return !label || label === url ? url : `${label} (${url})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)\s*>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|ul|ol|table|blockquote|section)\s*>/gi, "\n\n")
    .replace(/<\/tr\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return tidyText(decodeEntities(text));
}

/** http(s) URLs that appear in a text body, in order, without trailing punctuation. */
export function extractLinks(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    let url = match[0];
    for (;;) {
      const trimmed = url.replace(/[.,;:!?]+$/, "");
      // A closing bracket is punctuation only when nothing in the URL opened it.
      const unbalanced = /[)\]]$/.test(trimmed) && (trimmed.match(/[)\]]/g)?.length ?? 0) > (trimmed.match(/[([]/g)?.length ?? 0);
      const next = unbalanced ? trimmed.slice(0, -1) : trimmed;
      if (next === url) break;
      url = next;
    }
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/**
 * Builds a transactional email: one HTML document (inline styles only, no images, scripts or external
 * assets, readable at phone width, with real headings and link text for screen readers) and a plain-text
 * alternative that says the same thing.
 *
 *   const { html, text } = renderEmail({
 *     heading: "Sign in to Passport",
 *     paragraphs: ["Use the button below to sign in."],
 *     cta: { label: "Sign in", url },
 *     code: { label: "Or enter this code", value: "482913" },
 *     footerNote: "If you did not ask to sign in, you can ignore this email.",
 *   });
 *
 * Everything except `bodyHtml` is treated as plain text and escaped.
 */
export function renderEmail(input: RenderEmailInput): RenderedEmail {
  const locale: EmailLocale = input.locale === "es" ? "es" : "en";
  const phrases = PHRASES[locale];
  const heading = input.heading.trim();
  if (heading.length === 0) throw new AppError("internal", "renderEmail: heading is required");
  const paragraphs = (input.paragraphs ?? []).map((p) => p.trim()).filter((p) => p.length > 0);
  const details = (input.details ?? []).filter((d) => d.label.trim().length > 0);
  const cta = input.cta ? { label: input.cta.label.trim(), url: safeHttpUrl(input.cta.url) } : null;
  if (cta && cta.label.length === 0) throw new AppError("internal", "renderEmail: cta.label is required");
  const code = input.code && input.code.value.trim().length > 0 ? { label: input.code.label.trim(), value: input.code.value.trim() } : null;
  const footerNote = input.footerNote?.trim() ?? "";
  const preheader = input.preheader?.trim() ?? "";

  const p = (inner: string, extra = "") => `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.55;color:${COLOR.text};${extra}">${inner}</p>`;
  const body: string[] = [];
  if (input.bodyHtml !== undefined) {
    body.push(`<div style="font-size:16px;line-height:1.55;color:${COLOR.text};">${input.bodyHtml}</div>`);
  } else {
    for (const para of paragraphs) body.push(p(escapeHtml(para).replace(/\r?\n/g, "<br>")));
  }
  if (details.length > 0) {
    const rows = details
      .map(
        (d) =>
          `<tr><th scope="row" align="left" valign="top" style="padding:6px 16px 6px 0;font-size:14px;line-height:1.45;font-weight:400;color:${COLOR.muted};">${escapeHtml(d.label.trim())}</th>` +
          `<td align="left" valign="top" style="padding:6px 0;font-size:16px;line-height:1.45;color:${COLOR.text};">${escapeHtml(d.value.trim()).replace(/\r?\n/g, "<br>")}</td></tr>`,
      )
      .join("");
    body.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px 0;border-top:1px solid ${COLOR.border};border-bottom:1px solid ${COLOR.border};width:100%;">${rows}</table>`);
  }
  if (cta) {
    const href = escapeHtml(cta.url);
    body.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px 0;"><tr><td align="center" bgcolor="${COLOR.action}" style="border-radius:6px;">` +
        `<a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;line-height:1.2;font-weight:700;color:${COLOR.actionText};text-decoration:none;border-radius:6px;">${escapeHtml(cta.label)}</a>` +
        `</td></tr></table>`,
    );
    body.push(
      `<p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;color:${COLOR.muted};">${escapeHtml(phrases.linkFallback)}<br>` +
        `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:${COLOR.action};word-break:break-all;">${href}</a></p>`,
    );
  }
  if (code) {
    body.push(
      p(escapeHtml(code.label), "margin-bottom:8px;") +
        `<p style="margin:0 0 20px 0;padding:14px 16px;background-color:${COLOR.codeBg};border-radius:6px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:28px;line-height:1.2;font-weight:700;letter-spacing:0.2em;color:${COLOR.text};text-align:center;">${escapeHtml(code.value)}</p>`,
    );
  }

  const footerLines = [footerNote ? escapeHtml(footerNote).replace(/\r?\n/g, "<br>") : "", escapeHtml(phrases.sentBy(BRAND.name))].filter(Boolean);
  const html =
    `<!DOCTYPE html>\n<html lang="${locale}" dir="ltr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<meta name="color-scheme" content="light only">\n<meta name="x-apple-disable-message-reformatting">\n<title>${escapeHtml(heading)}</title>\n</head>\n` +
    `<body style="margin:0;padding:0;background-color:${COLOR.page};-webkit-text-size-adjust:100%;">\n` +
    (preheader ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${COLOR.page};">${escapeHtml(preheader)}</div>\n` : "") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR.page};">\n<tr><td align="center" style="padding:24px 12px;">\n` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:${COLOR.card};border:1px solid ${COLOR.border};border-radius:8px;">\n` +
    `<tr><td style="padding:24px 28px 0 28px;font-family:${FONT};font-size:15px;line-height:1.2;font-weight:700;letter-spacing:0.02em;color:${COLOR.brand};">${escapeHtml(BRAND.name)}</td></tr>\n` +
    `<tr><td style="padding:16px 28px 12px 28px;font-family:${FONT};color:${COLOR.text};">\n` +
    `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;font-weight:700;color:${COLOR.text};">${escapeHtml(heading)}</h1>\n` +
    `${body.join("\n")}\n</td></tr>\n</table>\n` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">\n` +
    `<tr><td style="padding:16px 28px;font-family:${FONT};font-size:13px;line-height:1.5;color:${COLOR.muted};">${footerLines.join("<br><br>")}</td></tr>\n</table>\n` +
    `</td></tr>\n</table>\n</body>\n</html>\n`;

  const textParts: string[] = [heading];
  if (input.bodyHtml !== undefined) {
    const converted = htmlToText(input.bodyHtml);
    if (converted) textParts.push(converted);
  } else {
    textParts.push(...paragraphs.map(tidyText));
  }
  if (details.length > 0) textParts.push(details.map((d) => `${d.label.trim()}: ${d.value.trim().replace(/\s*\r?\n\s*/g, ", ")}`).join("\n"));
  if (cta) textParts.push(`${cta.label}:\n${cta.url}`);
  if (code) textParts.push(`${code.label}: ${code.value}`);
  if (footerNote) textParts.push(tidyText(footerNote));
  textParts.push(phrases.sentBy(BRAND.name));

  return { html, text: `${textParts.join("\n\n")}\n` };
}
