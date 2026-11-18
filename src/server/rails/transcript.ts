/**
 * The IRS transcript path: guided self-download, then upload through the normal document path
 * (docs/reference/payments-and-rails.md facts 68-72 and 78). The parent signs in to their own IRS
 * Individual Online Account, downloads their prior-year Tax Return Transcript or Wage and Income
 * Transcript as a PDF, and uploads it; the document parser reads transcripts.
 *
 * We never ask for IRS credentials, never sign in for the parent and never automate their account: the IRS
 * says "The transcript services are for individual taxpayers to retrieve their own transcripts for their own
 * purposes. Use by any other entities is prohibited." (fact 72). IVES, Form 8821 and the Transcript Delivery
 * System are not used (facts 74-77).
 *
 * Only the "Tax Records" → "transcripts" path inside the account is confirmed by the IRS's public FAQ; the
 * screens behind sign-in were not seen (reference open question 23), so the steps stay at that level and say
 * the screens may differ.
 */
import { deriveKey, hmacSha256 } from "@/lib/crypto";
import { invalid } from "@/lib/errors";
import type { RailLocale } from "./copy";

export const TRANSCRIPT_GUIDE_VERSION = "transcript-guide.v1";

/** IRS pages the guide relies on (fetched for the reference on 2026-11-18). */
export const TRANSCRIPT_GUIDE_SOURCES = Object.freeze([
  "https://www.irs.gov/individuals/get-transcript",
  "https://www.irs.gov/individuals/get-transcript-faqs",
  "https://www.irs.gov/individuals/transcript-types-for-individuals-and-ways-to-order-them",
  "https://www.irs.gov/individuals/transcript-availability",
  "https://www.irs.gov/individuals/about-tax-transcripts",
]);

export interface TranscriptGuideStep {
  id: "sign_in" | "tax_records" | "choose" | "customer_file_number" | "download" | "upload";
  title: string;
  body: string;
}

export interface TranscriptGuide {
  version: string;
  locale: RailLocale;
  incomeYear: number | null;
  customerFileNumber: string | null;
  title: string;
  intro: string;
  /** Shown prominently: we never ask for IRS credentials and never sign in for the parent. */
  neverAsk: string;
  steps: TranscriptGuideStep[];
  /** Short facts about when a transcript exists and what it shows. */
  goodToKnow: string[];
  /** What to do when the online account is not an option. */
  otherWays: string[];
  screensMayDiffer: string;
  sources: readonly string[];
}

/**
 * A 10-digit Customer File Number for a verification. The IRS lets a taxpayer type a number of up to 10
 * digits that "cannot be a taxpayer identification number" and prints it on the transcript (fact 71); we
 * derive it from the verification id with a keyed hash, so it needs no storage and the document parser can
 * recompute it to check that an uploaded transcript was requested for this verification. Ten digits can
 * never be a nine-digit SSN or EIN.
 */
export function customerFileNumberFor(verificationId: string): string {
  if (typeof verificationId !== "string" || verificationId.length === 0) throw invalid("A verification id is required.");
  const mac = hmacSha256(deriveKey("transcript-customer-file-number"), verificationId);
  // 9 random digits after a non-zero lead digit; the modulo bias over 2^48 is negligible for a reference number.
  const n = Number(mac.readBigUInt64BE(0) % 1_000_000_000n);
  const lead = (mac[8]! % 9) + 1;
  return `${lead}${String(n).padStart(9, "0")}`;
}

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

const COPY = {
  en: {
    yearFallback: "last year",
    title: "Get your IRS transcript yourself, then upload it",
    intro:
      "An IRS transcript is a free summary of your tax information from the IRS. You download it yourself from your own IRS online account, then upload the PDF here like any other document.",
    neverAsk:
      "We will never ask for your IRS username, password or security codes, and we never sign in to the IRS for you. The IRS allows its transcript service only for people getting their own records.",
    steps: {
      sign_in: ["Sign in to your IRS online account", "Go to irs.gov and sign in to your Individual Online Account. The IRS uses Login.gov or ID.me to confirm who you are. If you do not have an account yet, the IRS will help you create one."],
      tax_records: ["Open your tax records", 'Open the "Tax Records" page, then the link for "transcripts".'],
      choose: [
        "Pick the right transcript for {year}",
        'If you filed a tax return for {year}, choose the "Tax Return Transcript". If you did not file, or your return has not been processed yet, choose the "Wage and Income Transcript". It lists the W-2 and 1099 forms the IRS received.',
      ],
      customer_file_number: ["Enter your reference number", 'If you see a box called "Customer File Number", type {cfn}. It prints on the transcript and links it to this application. This number is not your Social Security number.'],
      download: ["Save it as a PDF", "Download or save the transcript as a PDF file. A PDF is read more reliably than a photo of a printout."],
      upload: ["Upload it here", 'Come back to this page, choose "Upload documents" and add the PDF. You do not have to start over.'],
    },
    goodToKnow: [
      "A Tax Return Transcript is ready about 2 to 3 weeks after you file electronically, or 6 to 8 weeks after you mail a paper return.",
      "Wage and income information for a year usually starts to appear in the first week of February of the next year, and at first it may not include every form.",
      "Transcripts hide most personal details (only part of your name, address and Social Security number show). That is normal. All money amounts are shown.",
    ],
    otherWays: [
      "If you cannot use the online account, you can ask the IRS to mail you a Tax Return Transcript. It arrives in 5 to 10 calendar days at the address the IRS has for you. Request it at irs.gov/individuals/get-transcript or by calling 800-908-9946, then upload a scan or photo.",
      "You can also upload a W-2, your last pay stub of the year or your tax return instead.",
    ],
    screensMayDiffer: "The IRS screens may look a little different from these steps.",
  },
  es: {
    yearFallback: "el año pasado",
    title: "Obtenga usted mismo su transcripción del IRS y luego súbala",
    intro:
      "Una transcripción del IRS es un resumen gratuito de su información de impuestos. Usted la descarga desde su propia cuenta en línea del IRS y luego sube el PDF aquí, como cualquier otro documento.",
    neverAsk:
      "Nunca le pediremos su usuario, contraseña ni códigos de seguridad del IRS, y nunca iniciamos sesión en el IRS por usted. El IRS solo permite usar su servicio de transcripciones a las personas que obtienen sus propios registros.",
    steps: {
      sign_in: ["Inicie sesión en su cuenta en línea del IRS", "Vaya a irs.gov e inicie sesión en su cuenta en línea individual (Individual Online Account). El IRS usa Login.gov o ID.me para confirmar quién es usted. Si todavía no tiene una cuenta, el IRS le ayudará a crearla."],
      tax_records: ["Abra sus registros de impuestos", 'Abra la página "Tax Records" (registros de impuestos) y luego el enlace "transcripts" (transcripciones).'],
      choose: [
        "Elija la transcripción correcta de {year}",
        'Si presentó una declaración de impuestos de {year}, elija "Tax Return Transcript" (transcripción de la declaración). Si no la presentó, o si su declaración todavía no se ha procesado, elija "Wage and Income Transcript" (transcripción de salarios e ingresos). Esta muestra los formularios W-2 y 1099 que recibió el IRS.',
      ],
      customer_file_number: ["Escriba su número de referencia", 'Si ve una casilla llamada "Customer File Number", escriba {cfn}. Este número aparece impreso en la transcripción y la vincula con esta solicitud. No es su número de Seguro Social.'],
      download: ["Guárdela como PDF", "Descargue o guarde la transcripción como archivo PDF. Un PDF se lee con más seguridad que una foto de una hoja impresa."],
      upload: ["Súbala aquí", 'Regrese a esta página, elija "Subir documentos" y agregue el PDF. No tiene que empezar de nuevo.'],
    },
    goodToKnow: [
      "La transcripción de la declaración está lista unas 2 a 3 semanas después de presentar la declaración por internet, o de 6 a 8 semanas después de enviarla en papel por correo.",
      "La información de salarios e ingresos de un año normalmente empieza a aparecer en la primera semana de febrero del año siguiente, y al principio puede no incluir todos los formularios.",
      "Las transcripciones ocultan la mayoría de los datos personales (solo se ve parte de su nombre, dirección y número de Seguro Social). Es normal. Se muestran todas las cantidades de dinero.",
    ],
    otherWays: [
      "Si no puede usar la cuenta en línea, puede pedir al IRS que le envíe por correo una transcripción de la declaración. Llega en 5 a 10 días naturales a la dirección que el IRS tiene registrada. Pídala en irs.gov/individuals/get-transcript o llamando al 800-908-9946, y luego suba una copia escaneada o una foto.",
      "También puede subir un W-2, su último talón de pago del año o su declaración de impuestos.",
    ],
    screensMayDiffer: "Las pantallas del IRS pueden verse un poco diferentes de estos pasos.",
  },
} as const;

const STEP_ORDER: readonly TranscriptGuideStep["id"][] = ["sign_in", "tax_records", "choose", "customer_file_number", "download", "upload"];

/**
 * Step-by-step instructions for a parent to download their own prior-year transcript and upload it.
 * `incomeYear` names the year; `customerFileNumber` (from `customerFileNumberFor`) adds the reference-number
 * step. Pure: no database, no network.
 */
export function getTranscriptGuide(locale: RailLocale, opts: { incomeYear?: number | null; customerFileNumber?: string | null } = {}): TranscriptGuide {
  if (locale !== "en" && locale !== "es") throw invalid("Unknown language.");
  const incomeYear = opts.incomeYear ?? null;
  if (incomeYear !== null && (!Number.isInteger(incomeYear) || incomeYear < 2000 || incomeYear > 2999)) throw invalid("The income year is not valid.");
  const cfn = opts.customerFileNumber ?? null;
  if (cfn !== null && !/^[1-9]\d{9}$/.test(cfn)) throw invalid("The Customer File Number must be 10 digits.");
  const c = COPY[locale];
  const vars = { year: incomeYear === null ? c.yearFallback : String(incomeYear), cfn: cfn ?? "" };
  const steps = STEP_ORDER.filter((id) => id !== "customer_file_number" || cfn !== null).map((id) => ({ id, title: fill(c.steps[id][0], vars), body: fill(c.steps[id][1], vars) }));
  return {
    version: TRANSCRIPT_GUIDE_VERSION,
    locale,
    incomeYear,
    customerFileNumber: cfn,
    title: c.title,
    intro: c.intro,
    neverAsk: c.neverAsk,
    steps,
    goodToKnow: [...c.goodToKnow],
    otherWays: [...c.otherWays],
    screensMayDiffer: c.screensMayDiffer,
    sources: TRANSCRIPT_GUIDE_SOURCES,
  };
}
