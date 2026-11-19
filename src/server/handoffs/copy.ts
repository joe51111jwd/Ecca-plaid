import type { HandoffStatus } from "@/db/schema";
import { BRAND } from "@/lib/brand";
import { formatUsd } from "@/lib/money";

/**
 * Words shown about a handoff. Rules (spec, Piece 2 risks; docs/reference/market-and-integration-context.md
 * implications 4.9 and 4.12):
 *  - verifying income never promises a scholarship, and an award never promises that the business will be paid;
 *  - "eligible" always says the SGO's award decision is still to come;
 *  - the family is never told it will be paid, and never sees a fee;
 *  - no reasons beyond eligible / not eligible / pending.
 * Version the copy when its meaning changes so screens and tests can pin it.
 */
export const HANDOFF_COPY_VERSION = "handoff-copy-2026-11-18";

export type Locale = "en" | "es";

export interface StatusText {
  headline: string;
  body: string;
}

export interface CopyContext {
  businessName: string;
  /** The partner SGO's display name; null while the family has not chosen one. */
  sgoName: string | null;
  /** Hold deadline, already formatted for the locale (null when no hold applies). */
  holdDeadline: string | null;
  /** Offered award amount in cents, when there is one. */
  awardAmountCents: number | null;
}

const holdLine = {
  en: (c: CopyContext) => (c.holdDeadline ? ` ${c.businessName} is holding your reservation until ${c.holdDeadline}.` : ""),
  es: (c: CopyContext) => (c.holdDeadline ? ` ${c.businessName} mantiene su reservación hasta el ${c.holdDeadline}.` : ""),
};

const sgoOr = {
  en: (c: CopyContext) => c.sgoName ?? "the scholarship organization",
  es: (c: CopyContext) => c.sgoName ?? "la organización de becas",
};

type StatusCopy = Record<HandoffStatus | "choose_sgo", (c: CopyContext) => StatusText>;

const EN: StatusCopy = {
  choose_sgo: (c) => ({
    headline: "Choose a scholarship organization",
    body: `${c.businessName} works with more than one scholarship organization. Choose the one you want to apply to, then check whether your household meets its income limit.${holdLine.en(c)}`,
  }),
  started: (c) => ({
    headline: "Check whether your household may qualify",
    body: `Verify your household income with ${sgoOr.en(c)}. It is free for families. Verifying does not guarantee a scholarship.${holdLine.en(c)}`,
  }),
  verifying: (c) => ({
    headline: "Finish your income verification",
    body: `Pick up where you left off and submit your information to ${sgoOr.en(c)}.${holdLine.en(c)}`,
  }),
  held: (c) => ({
    headline: "Your information was submitted",
    body: `The result is pending. We will let you know when it is ready.${holdLine.en(c)}`,
  }),
  eligible: (c) => ({
    headline: "Your household meets the income limit",
    body: `${sgoOr.en(c)} now decides whether to award a scholarship for this booking. That decision is theirs alone: a scholarship is not guaranteed, and ${c.businessName} has not been paid.${holdLine.en(c)}`,
  }),
  awarded: (c) => ({
    headline: `${sgoOr.en(c)} offered a scholarship for this booking`,
    body: `${c.awardAmountCents !== null ? `The offer is ${formatUsd(c.awardAmountCents)}. ` : ""}${sgoOr.en(c)} handles payment under its own rules. ${c.businessName} will tell you when your booking is confirmed.`,
  }),
  completed: (c) => ({
    headline: "Your booking is complete",
    body: `${c.businessName} confirmed that your booking was completed with scholarship funds.`,
  }),
  declined: (c) => ({
    headline: "A scholarship is not available for this booking",
    body: `The reservation hold has ended. You can still book directly with ${c.businessName}, and you can see your verification result in your ${BRAND.name} account.`,
  }),
  expired: (c) => ({
    headline: "The reservation hold has ended",
    body: `The hold window passed before a scholarship was awarded. Contact ${c.businessName} about your booking.`,
  }),
  canceled: (c) => ({
    headline: "This scholarship check was canceled",
    body: `Contact ${c.businessName} if you still want to book.`,
  }),
};

const ES: StatusCopy = {
  choose_sgo: (c) => ({
    headline: "Elija una organización de becas",
    body: `${c.businessName} trabaja con más de una organización de becas. Elija a cuál quiere solicitar y luego verifique si su hogar cumple con su límite de ingresos.${holdLine.es(c)}`,
  }),
  started: (c) => ({
    headline: "Verifique si su hogar podría calificar",
    body: `Verifique los ingresos de su hogar con ${sgoOr.es(c)}. Es gratis para las familias. La verificación no garantiza una beca.${holdLine.es(c)}`,
  }),
  verifying: (c) => ({
    headline: "Termine su verificación de ingresos",
    body: `Continúe donde se quedó y envíe su información a ${sgoOr.es(c)}.${holdLine.es(c)}`,
  }),
  held: (c) => ({
    headline: "Su información fue enviada",
    body: `El resultado está pendiente. Le avisaremos cuando esté listo.${holdLine.es(c)}`,
  }),
  eligible: (c) => ({
    headline: "Su hogar cumple con el límite de ingresos",
    body: `Ahora ${sgoOr.es(c)} decide si otorga una beca para esta reservación. Esa decisión es solo suya: la beca no está garantizada y ${c.businessName} no ha recibido ningún pago.${holdLine.es(c)}`,
  }),
  awarded: (c) => ({
    headline: `${sgoOr.es(c)} ofreció una beca para esta reservación`,
    body: `${c.awardAmountCents !== null ? `La oferta es de ${formatUsd(c.awardAmountCents)}. ` : ""}${sgoOr.es(c)} maneja el pago según sus propias reglas. ${c.businessName} le avisará cuando su reservación esté confirmada.`,
  }),
  completed: (c) => ({
    headline: "Su reservación está completa",
    body: `${c.businessName} confirmó que su reservación se completó con fondos de beca.`,
  }),
  declined: (c) => ({
    headline: "No hay una beca disponible para esta reservación",
    body: `La reservación ya no está retenida. Todavía puede reservar directamente con ${c.businessName} y puede ver el resultado de su verificación en su cuenta de ${BRAND.name}.`,
  }),
  expired: (c) => ({
    headline: "La retención de su reservación terminó",
    body: `El plazo de retención pasó antes de que se otorgara una beca. Comuníquese con ${c.businessName} sobre su reservación.`,
  }),
  canceled: (c) => ({
    headline: "Esta verificación de beca fue cancelada",
    body: `Comuníquese con ${c.businessName} si todavía quiere reservar.`,
  }),
};

export function statusText(locale: Locale, key: HandoffStatus | "choose_sgo", ctx: CopyContext): StatusText {
  return (locale === "es" ? ES : EN)[key](ctx);
}

/** Standing notices on the family's handoff page. */
export function familyNotices(locale: Locale, opts: { businessName: string; provisional: boolean; sandbox: boolean }): string[] {
  const out: string[] =
    locale === "es"
      ? [
          `Las familias nunca pagan por verificar. ${opts.businessName} paga a ${BRAND.name} por este servicio; ninguna tarifa se descuenta de su beca.`,
          "Verificar sus ingresos no garantiza una beca. Cada organización de becas toma sus propias decisiones.",
        ]
      : [
          `Families never pay to verify. ${opts.businessName} pays ${BRAND.name} for this service; no fee is taken from your scholarship.`,
          "Verifying your income does not guarantee a scholarship. Each scholarship organization makes its own award decisions.",
        ];
  if (opts.provisional) {
    out.push(
      locale === "es"
        ? "Este resultado es provisional: según las reglas propuestas, usa una tabla de ingresos basada en datos de HUD hasta que el IRS publique la suya."
        : "This result is provisional: under the proposed rules it uses an income table based on HUD data until the IRS publishes its own.",
    );
  }
  if (opts.sandbox) out.push(locale === "es" ? "Modo de prueba: nada aquí es real." : "Test mode: nothing here is real.");
  return out;
}

/**
 * One line per status for the business portal and API (`status_detail`). "eligible" says exactly what it means:
 * the household passed verification and the SGO has not yet decided whether to award.
 */
export const BUSINESS_STATUS_DETAIL: Readonly<Record<HandoffStatus, string>> = Object.freeze({
  started: "The family has the link but has not started verification yet. The reservation is on hold.",
  verifying: "The family is verifying household income. The reservation is on hold.",
  held: "The family submitted. The verification result or the SGO's decision is pending. The reservation is on hold.",
  eligible: "Verification eligible; awaiting the SGO's award decision. This is not an award and not a payment. The reservation is on hold.",
  awarded: "The SGO offered a scholarship award for this booking. The SGO pays under its own rules; this is not a payment. Confirm the booking when it is completed with scholarship funds.",
  completed: "You confirmed the booking was completed with scholarship funds.",
  declined: "No scholarship for this booking (not eligible, or the SGO did not award). The hold has ended.",
  expired: "The hold window passed without an award. The hold has ended.",
  canceled: "The handoff was canceled. The hold has ended.",
});

const DEADLINE_FORMAT: Record<Locale, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", dateStyle: "long", timeStyle: "short" }),
  es: new Intl.DateTimeFormat("es-US", { timeZone: "America/Chicago", dateStyle: "long", timeStyle: "short" }),
};

/** A hold deadline in Texas (US Central) time, e.g. "November 21, 2026 at 10:00 AM CST". */
export function formatDeadline(locale: Locale, at: Date): string {
  const parts = DEADLINE_FORMAT[locale].format(at);
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value;
  return zone ? `${parts} ${zone}` : parts;
}
