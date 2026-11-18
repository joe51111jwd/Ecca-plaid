import type { RailFailureReason, RailStatus } from "./types";

/**
 * Plain-language words the family sees about data connections, in English and Spanish. The family UI
 * owns its page dictionaries; these sentences live here because the service decides which one applies.
 * Every failure message ends by pointing at the upload path, which is always available.
 */
export type RailLocale = "en" | "es";

export const RAIL_FAILURE_COPY: Readonly<Record<RailFailureReason, Readonly<Record<RailLocale, string>>>> = Object.freeze({
  provider_unavailable: {
    en: "The payroll or bank service is not answering right now. You can upload your documents instead. Nothing you already entered is lost.",
    es: "El servicio de nómina o de banco no responde en este momento. Puede subir sus documentos en su lugar. No se pierde nada de lo que ya ingresó.",
  },
  employer_not_found: {
    en: "We could not find your employer or bank through this service. You can upload your documents instead. Nothing you already entered is lost.",
    es: "No pudimos encontrar a su empleador o su banco por medio de este servicio. Puede subir sus documentos en su lugar. No se pierde nada de lo que ya ingresó.",
  },
  no_data_for_year: {
    en: "The connection worked, but it has no pay records for the year we need. Please upload a W-2, your last pay stub of that year, a tax return or an IRS transcript instead.",
    es: "La conexión funcionó, pero no tiene registros de pago del año que necesitamos. Suba un formulario W-2, su último talón de pago de ese año, una declaración de impuestos o una transcripción del IRS en su lugar.",
  },
  connection_expired: {
    en: "The connection timed out before it finished. You can try again or upload your documents instead. Nothing you already entered is lost.",
    es: "La conexión se venció antes de terminar. Puede intentarlo de nuevo o subir sus documentos en su lugar. No se pierde nada de lo que ya ingresó.",
  },
  records_unreadable: {
    en: "The service connected but could not read your pay records. Please upload your documents instead. Nothing you already entered is lost.",
    es: "El servicio se conectó pero no pudo leer sus registros de pago. Suba sus documentos en su lugar. No se pierde nada de lo que ya ingresó.",
  },
});

export function railFailureMessage(reason: RailFailureReason, locale: RailLocale = "en"): string {
  return RAIL_FAILURE_COPY[reason][locale];
}

export const RAIL_DECLINED_COPY: Readonly<Record<RailLocale, string>> = Object.freeze({
  en: "You chose not to connect. That is fine: upload your documents instead. Nothing you already entered is lost.",
  es: "Usted decidió no conectar su cuenta. Está bien: suba sus documentos en su lugar. No se pierde nada de lo que ya ingresó.",
});

export const RAIL_REVOKED_COPY: Readonly<Record<RailLocale, string>> = Object.freeze({
  en: "You disconnected this account. We no longer get records from it.",
  es: "Usted desconectó esta cuenta. Ya no recibimos registros de ella.",
});

/** Short status words for a list of connections. */
export const RAIL_STATUS_LABELS: Readonly<Record<RailStatus, Readonly<Record<RailLocale, string>>>> = Object.freeze({
  created: { en: "Not started", es: "Sin empezar" },
  connecting: { en: "Waiting for you to sign in", es: "Esperando a que inicie sesión" },
  connected: { en: "Connected", es: "Conectada" },
  syncing: { en: "Getting your records", es: "Obteniendo sus registros" },
  ready: { en: "Records received", es: "Registros recibidos" },
  failed: { en: "Did not work", es: "No funcionó" },
  declined: { en: "You chose not to connect", es: "Decidió no conectar" },
  revoked: { en: "Disconnected", es: "Desconectada" },
});

/** Words that mark the simulated provider everywhere it appears. One constant so UI and tests agree. */
export const SIMULATED_PROVIDER_NAME = "Simulated payroll provider — sandbox";
