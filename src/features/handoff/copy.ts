/**
 * Page wording of the family-facing handoff page (/h/{token}, /embed/handoff/{token}) that the handoffs service does
 * not already own. The status headline and body, the standing notices and the hold deadline come from
 * src/server/handoffs (statusText, familyNotices, formatDeadline) so the rules there hold here too:
 *  - verifying never promises a scholarship and an award never promises that the business will be paid;
 *  - "eligible" always says the organization still has to decide on an award;
 *  - the family never sees a fee.
 * A test pins these strings against those rules. Bump the version when a meaning changes.
 */
import type { HandoffStatus } from "@/db/schema";

export const FAMILY_PAGE_COPY_VERSION = "handoff-page-2026-11-18";

export type FamilyLocale = "en" | "es";

export interface FamilyPageCopy {
  pageTitle: string;
  /** Shown beside the business's name in the header. */
  withBusiness: (business: string) => string;
  bookingHeading: string;
  bookingRef: string;
  bookingAmount: string;
  student: string;
  /** The offer line under the booking card. */
  offer: string;
  offerWithSgo: (sgo: string) => string;
  holdLine: (deadline: string) => string;
  holdEnded: string;
  chooseHeading: string;
  chooseHint: string;
  chooseSubmit: string;
  choosePending: string;
  chooseError: string;
  startVerification: string;
  continueVerification: string;
  seeResult: string;
  opensInNewTab: string;
  liveStatusNote: string;
  statusHeading: string;
  progressLabel: string;
  steps: { held: string; verify: string; decide: string; booked: string };
  returnTo: (business: string) => string;
  cancelLink: string;
  cancelTitle: string;
  cancelDescription: (business: string) => string;
  cancelConfirm: string;
  cancelError: string;
  notFoundTitle: string;
  notFoundBody: string;
  framedBlockedTitle: string;
  framedBlockedBody: string;
  framedBlockedOpen: string;
  sandbox: string;
}

const EN: FamilyPageCopy = {
  pageTitle: "Pay with a scholarship",
  withBusiness: (b) => `with ${b}`,
  bookingHeading: "Your booking",
  bookingRef: "Booking reference",
  bookingAmount: "Booking total",
  student: "Student",
  offer: "A partner scholarship organization can check if you qualify.",
  offerWithSgo: (sgo) => `A partner scholarship organization, ${sgo}, can check if you qualify.`,
  holdLine: (deadline) => `We'll hold your spot until ${deadline}.`,
  holdEnded: "Your spot is no longer being held.",
  chooseHeading: "Choose a scholarship organization",
  chooseHint: "Each organization decides its own awards. You can apply to one from this booking.",
  chooseSubmit: "Continue with this organization",
  choosePending: "Saving…",
  chooseError: "We could not save your choice",
  startVerification: "Check if I qualify",
  continueVerification: "Continue my income check",
  seeResult: "See my verification result",
  opensInNewTab: "Opens in a new tab. Come back to this page to see your status.",
  liveStatusNote: "This page updates on its own.",
  statusHeading: "Status",
  progressLabel: "Scholarship progress",
  steps: { held: "Spot held", verify: "Income check", decide: "Organization decides", booked: "Booking confirmed" },
  returnTo: (b) => `Return to ${b}`,
  cancelLink: "I don't want to use a scholarship for this booking",
  cancelTitle: "Stop this scholarship check?",
  cancelDescription: (b) => `${b} will be told that you stopped. You can still book directly with ${b}.`,
  cancelConfirm: "Stop the scholarship check",
  cancelError: "We could not stop the scholarship check",
  notFoundTitle: "This link is not valid",
  notFoundBody: "Check that you copied the whole link, or go back to the booking page and start again.",
  framedBlockedTitle: "This page can't be shown here",
  framedBlockedBody: "For your security, open the scholarship check in its own tab.",
  framedBlockedOpen: "Open in a new tab",
  sandbox: "Test mode: nothing here is real.",
};

const ES: FamilyPageCopy = {
  pageTitle: "Pagar con una beca",
  withBusiness: (b) => `con ${b}`,
  bookingHeading: "Su reservación",
  bookingRef: "Número de reservación",
  bookingAmount: "Total de la reservación",
  student: "Estudiante",
  offer: "Una organización de becas asociada puede verificar si usted califica.",
  offerWithSgo: (sgo) => `Una organización de becas asociada, ${sgo}, puede verificar si usted califica.`,
  holdLine: (deadline) => `Mantendremos su lugar hasta el ${deadline}.`,
  holdEnded: "Su lugar ya no está reservado.",
  chooseHeading: "Elija una organización de becas",
  chooseHint: "Cada organización decide sus propias becas. Puede solicitar a una desde esta reservación.",
  chooseSubmit: "Continuar con esta organización",
  choosePending: "Guardando…",
  chooseError: "No pudimos guardar su elección",
  startVerification: "Verificar si califico",
  continueVerification: "Continuar mi verificación de ingresos",
  seeResult: "Ver el resultado de mi verificación",
  opensInNewTab: "Se abre en una pestaña nueva. Regrese a esta página para ver su estado.",
  liveStatusNote: "Esta página se actualiza sola.",
  statusHeading: "Estado",
  progressLabel: "Progreso de la beca",
  steps: { held: "Lugar reservado", verify: "Verificación de ingresos", decide: "La organización decide", booked: "Reservación confirmada" },
  returnTo: (b) => `Regresar a ${b}`,
  cancelLink: "No quiero usar una beca para esta reservación",
  cancelTitle: "¿Detener esta verificación de beca?",
  cancelDescription: (b) => `Le avisaremos a ${b} que usted se detuvo. Todavía puede reservar directamente con ${b}.`,
  cancelConfirm: "Detener la verificación de beca",
  cancelError: "No pudimos detener la verificación de beca",
  notFoundTitle: "Este enlace no es válido",
  notFoundBody: "Revise que copió el enlace completo, o regrese a la página de reservación y empiece de nuevo.",
  framedBlockedTitle: "Esta página no se puede mostrar aquí",
  framedBlockedBody: "Por su seguridad, abra la verificación de beca en su propia pestaña.",
  framedBlockedOpen: "Abrir en una pestaña nueva",
  sandbox: "Modo de prueba: nada aquí es real.",
};

export function familyPageCopy(locale: FamilyLocale): FamilyPageCopy {
  return locale === "es" ? ES : EN;
}

/** `?lang=es` selects Spanish; anything else is English. */
export function pickFamilyLocale(value: string | string[] | undefined | null): FamilyLocale {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "es" ? "es" : "en";
}

/** Label for the primary button into the verification flow, by handoff status. */
export function verificationButtonLabel(locale: FamilyLocale, status: HandoffStatus): string {
  const t = familyPageCopy(locale);
  if (status === "started") return t.startVerification;
  if (status === "verifying") return t.continueVerification;
  return t.seeResult;
}
