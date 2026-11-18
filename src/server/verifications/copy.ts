/**
 * Copy owned by the verification lifecycle: the family invitation, the emails sent when a decision is made, the
 * reviewer notice and the versioned wording of the income certifications.
 *
 * Copy rules (docs/architecture.md): nothing here promises an award, nothing presents the proposed rules as
 * settled law, and family messages never show an income figure. Decision wording comes from
 * `explainDecision` (src/engine/decision); this file only frames it.
 */
import type { CertificationKind, VerificationLocale } from "@/db/schema";
import { formatLongDate } from "@/engine/income";
import { BRAND } from "@/lib/brand";
import { sha256Hex } from "@/lib/crypto";
import { invalid } from "@/lib/errors";

/* ------------------------------------------------------------------------------------- invitation */

export interface InvitationCopy {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  cta: string;
  footerNote: string;
}

/** The email that carries the family link. `linkExpiresOn` is a YYYY-MM-DD date in US Central time. */
export function invitationCopy(locale: VerificationLocale, orgName: string, linkExpiresOn: string): InvitationCopy {
  const until = formatLongDate(linkExpiresOn, locale);
  if (locale === "es") {
    return {
      subject: `${orgName} le pide confirmar los ingresos de su hogar`,
      preheader: `El enlace funciona hasta el ${until}.`,
      heading: "Confirme los ingresos de su hogar",
      paragraphs: [
        `${orgName} usa ${BRAND.name} para revisar el requisito de ingresos del hogar de su programa de becas.`,
        "Toque el botón para comenzar. Puede subir documentos o, donde esté disponible, conectar una cuenta de nómina o de banco. Puede cambiar de opción en cualquier momento sin perder lo que ya hizo.",
        `El enlace funciona hasta el ${until}. Manténgalo privado.`,
        `Revisar los ingresos no significa que se otorgue una beca: ${orgName} decide las becas por separado.`,
      ],
      cta: "Comenzar",
      footerNote: "Si usted no esperaba este correo, puede ignorarlo.",
    };
  }
  return {
    subject: `${orgName} asks you to confirm your household income`,
    preheader: `The link works until ${until}.`,
    heading: "Confirm your household income",
    paragraphs: [
      `${orgName} uses ${BRAND.name} to check the household income requirement for its scholarship program.`,
      "Tap the button to start. You can upload documents or, where available, connect a payroll or bank account. You can switch between the two at any time without losing what you have done.",
      `The link works until ${until}. Keep it private.`,
      `Checking income does not mean a scholarship is awarded: ${orgName} decides scholarships separately.`,
    ],
    cta: "Start",
    footerNote: "If you were not expecting this email, you can ignore it.",
  };
}

/* ------------------------------------------------------------------------------- family decisions */

export interface FamilyDecisionEmailFrame {
  subject: string;
  cta: string;
  missingHeading: string;
}

/** Subject and button around `explainDecision(...).family` for the email a family gets after a decision step. */
export function familyDecisionEmailFrame(locale: VerificationLocale, kind: "outcome" | "more_information"): FamilyDecisionEmailFrame {
  if (locale === "es") {
    return kind === "outcome"
      ? { subject: "Su verificación de ingresos está completa", cta: "Ver los detalles", missingHeading: "Todavía necesitamos" }
      : { subject: "Necesitamos un poco más de información", cta: "Continuar", missingHeading: "Todavía necesitamos" };
  }
  return kind === "outcome"
    ? { subject: "Your income check is complete", cta: "See the details", missingHeading: "We still need" }
    : { subject: "We need a little more information", cta: "Continue", missingHeading: "We still need" };
}

/* ------------------------------------------------------------------------------- certifications */

/** Bump when any word of a certification changes; stored with every signature. */
export const CERTIFICATION_COPY_VERSION = "income_certification.v1";

export interface CertificationVars {
  /** Name of the adult signing, as entered on the household roster. */
  signerName: string;
  /** Name of the member the statement is about; omitted for a household-wide statement. */
  memberName?: string;
  incomeYear: number;
  organizationName: string;
}

export interface RenderedCertification {
  kind: CertificationKind;
  version: string;
  locale: VerificationLocale;
  title: string;
  paragraphs: string[];
  checkboxLabel: string;
  /** Title, paragraphs and checkbox label joined by blank lines: the exact string that is hashed. */
  text: string;
  sha256: string;
  vars: Record<string, string | number>;
}

type Scope = "member" | "household";

interface CertificationTemplate {
  title: string;
  paragraphs: (v: Required<Omit<CertificationVars, "memberName">> & { memberName: string }) => string[];
  checkboxLabel: string;
}

const RELIANCE: Record<VerificationLocale, (v: { organizationName: string }) => string> = {
  en: (v) =>
    `I understand that ${v.organizationName}, a scholarship granting organization, will rely on this statement to check the household income requirement of its federal tax credit scholarship program under the proposed rules, and that this statement is kept with the verification record.`,
  es: (v) =>
    `Entiendo que ${v.organizationName}, una organización que otorga becas, usará esta declaración para revisar el requisito de ingresos del hogar de su programa de becas del crédito fiscal federal según las reglas propuestas, y que esta declaración se guarda con el registro de la verificación.`,
};

const TEMPLATES: Record<CertificationKind, Partial<Record<Scope, Record<VerificationLocale, CertificationTemplate>>>> = {
  zero_income: {
    member: {
      en: {
        title: "Statement of no income",
        paragraphs: (v) => [
          `I, ${v.signerName}, am an adult who lives in this household.`,
          `I state that ${v.memberName} had no income of any kind in ${v.incomeYear}: no wages, no self-employment income, no benefits paid in cash, no child support, no alimony and no other money received from any source.`,
          RELIANCE.en(v),
          "If anything in this statement is not correct, do not sign it. You can upload documents instead.",
        ],
        checkboxLabel: "I have read this statement. It is true and complete.",
      },
      es: {
        title: "Declaración de que no hubo ingresos",
        paragraphs: (v) => [
          `Yo, ${v.signerName}, soy un adulto que vive en este hogar.`,
          `Declaro que ${v.memberName} no tuvo ingresos de ningún tipo en ${v.incomeYear}: ni salarios, ni ingresos de trabajo por cuenta propia, ni beneficios pagados en efectivo, ni manutención de hijos, ni pensión alimenticia, ni ningún otro dinero recibido de ninguna fuente.`,
          RELIANCE.es(v),
          "Si algo en esta declaración no es correcto, no la firme. En su lugar puede subir documentos.",
        ],
        checkboxLabel: "Leí esta declaración. Es verdadera y completa.",
      },
    },
  },
  no_other_income: {
    member: {
      en: {
        title: "Statement of no other income",
        paragraphs: (v) => [
          `I, ${v.signerName}, am an adult who lives in this household.`,
          `I state that in ${v.incomeYear} ${v.memberName} received no income other than what is shown in the documents and connections provided for this verification. This includes child support, alimony, and money from work, benefits or any other source.`,
          RELIANCE.en(v),
          "If anything in this statement is not correct, do not sign it. You can upload documents for the other income instead.",
        ],
        checkboxLabel: "I have read this statement. It is true and complete.",
      },
      es: {
        title: "Declaración de que no hubo otros ingresos",
        paragraphs: (v) => [
          `Yo, ${v.signerName}, soy un adulto que vive en este hogar.`,
          `Declaro que en ${v.incomeYear} ${v.memberName} no recibió ingresos aparte de los que muestran los documentos y las conexiones entregados para esta verificación. Esto incluye la manutención de hijos, la pensión alimenticia y el dinero del trabajo, de beneficios o de cualquier otra fuente.`,
          RELIANCE.es(v),
          "Si algo en esta declaración no es correcto, no la firme. En su lugar puede subir documentos de los otros ingresos.",
        ],
        checkboxLabel: "Leí esta declaración. Es verdadera y completa.",
      },
    },
    household: {
      en: {
        title: "Statement of no other household income",
        paragraphs: (v) => [
          `I, ${v.signerName}, am an adult who lives in this household.`,
          `I state that in ${v.incomeYear} no one who lives with the student received income other than what is shown in the documents and connections provided for this verification. This includes child support, alimony, and money from work, benefits or any other source.`,
          RELIANCE.en(v),
          "If anything in this statement is not correct, do not sign it. You can upload documents for the other income instead.",
        ],
        checkboxLabel: "I have read this statement. It is true and complete.",
      },
      es: {
        title: "Declaración de que no hubo otros ingresos en el hogar",
        paragraphs: (v) => [
          `Yo, ${v.signerName}, soy un adulto que vive en este hogar.`,
          `Declaro que en ${v.incomeYear} nadie que vive con el estudiante recibió ingresos aparte de los que muestran los documentos y las conexiones entregados para esta verificación. Esto incluye la manutención de hijos, la pensión alimenticia y el dinero del trabajo, de beneficios o de cualquier otra fuente.`,
          RELIANCE.es(v),
          "Si algo en esta declaración no es correcto, no la firme. En su lugar puede subir documentos de los otros ingresos.",
        ],
        checkboxLabel: "Leí esta declaración. Es verdadera y completa.",
      },
    },
  },
};

function cleanVar(value: string, name: string): string {
  const v = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (v.length === 0 || v.length > 200) throw invalid(`The certification is missing a valid ${name}.`);
  return v;
}

/**
 * Renders a certification for display and for storage. A zero-income statement always names a member; a
 * no-other-income statement names a member or, without one, covers the household. Re-rendering with the stored
 * version, locale and vars reproduces the same text and hash.
 */
export function renderCertification(kind: CertificationKind, locale: VerificationLocale, vars: CertificationVars, opts: { version?: string } = {}): RenderedCertification {
  const version = opts.version ?? CERTIFICATION_COPY_VERSION;
  if (version !== CERTIFICATION_COPY_VERSION) throw invalid(`Unknown certification version ${version}.`);
  if (locale !== "en" && locale !== "es") throw invalid("Unknown language.");
  if (!Number.isInteger(vars.incomeYear) || vars.incomeYear < 2000 || vars.incomeYear > 2999) throw invalid("The certification needs a valid income year.");
  const scope: Scope = vars.memberName === undefined ? "household" : "member";
  const templates = TEMPLATES[kind]?.[scope];
  if (!templates) throw invalid(kind === "zero_income" ? "A statement of no income must name the person it is about." : "Unknown certification kind.");
  const clean = {
    signerName: cleanVar(vars.signerName, "signer name"),
    organizationName: cleanVar(vars.organizationName, "organization name"),
    incomeYear: vars.incomeYear,
    memberName: scope === "member" ? cleanVar(vars.memberName ?? "", "member name") : "",
  };
  const template = templates[locale];
  const paragraphs = template.paragraphs(clean);
  const text = [template.title, ...paragraphs, template.checkboxLabel].join("\n\n");
  const stored: Record<string, string | number> = { signerName: clean.signerName, organizationName: clean.organizationName, incomeYear: clean.incomeYear };
  if (scope === "member") stored.memberName = clean.memberName;
  return { kind, version, locale, title: template.title, paragraphs, checkboxLabel: template.checkboxLabel, text, sha256: sha256Hex(text), vars: stored };
}

/* ---------------------------------------------------------------------------------- SGO notifications */

export interface SgoNotificationItem {
  verificationId: string;
  externalRef: string | null;
  /** Points a reviewer has to settle (needs_review) — never the points themselves, which stay behind sign-in. */
  reasonCount?: number;
  /** The decision (decided). */
  status?: "eligible" | "ineligible";
  decidedBy?: "engine" | "reviewer";
}

export interface SgoNotificationCopy {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta: string;
}

/**
 * SGO-facing, English, one or many verifications (a digest is the same email with more lines). Names no household
 * member, shows no figure and no family-supplied text: the details are behind sign-in.
 */
export function sgoNotificationCopy(kind: "needs_review" | "decided", input: { mode: "test" | "live"; items: readonly SgoNotificationItem[] }): SgoNotificationCopy {
  const tag = input.mode === "test" ? "[Test] " : "";
  const n = input.items.length;
  const ref = (i: SgoNotificationItem) => `${i.verificationId}${i.externalRef ? ` (your reference ${i.externalRef})` : ""}`;
  if (kind === "needs_review") {
    const lines = input.items.map((i) => {
      const count = i.reasonCount ?? 0;
      return `Verification ${ref(i)}: ${count === 1 ? "1 point" : `${count} points`} to settle.`;
    });
    return {
      subject: n === 1 ? `${tag}A verification needs review` : `${tag}${n} verifications need review`,
      heading: n === 1 ? "A verification needs review" : `${n} verifications need review`,
      paragraphs: [...lines, "A reviewer must look at these before they can be decided. Sign in to the dashboard to see the details."],
      cta: n === 1 ? "Open in the dashboard" : "Open the review queue",
    };
  }
  const lines = input.items.map((i) => {
    const outcome = i.status === "ineligible" ? "income above the limit" : "meets the income requirement";
    return `Verification ${ref(i)}: ${outcome}${i.decidedBy === "reviewer" ? " (resolved by a reviewer)" : ""}.`;
  });
  return {
    subject: n === 1 ? `${tag}A verification has been decided` : `${tag}${n} verifications have been decided`,
    heading: n === 1 ? "A verification has been decided" : `${n} verifications have been decided`,
    paragraphs: [...lines, "The evidence pack is ready to download in the dashboard. Verifying income is one requirement; awards remain your organization's decision."],
    cta: n === 1 ? "Open in the dashboard" : "Open the dashboard",
  };
}

/* ------------------------------------------------------------------------------- reviewer request */

export interface FamilyRequestEmailCopy {
  subject: string;
  heading: string;
  intro: string;
  itemsHeading: string;
  cta: string;
}

/**
 * Frame around a reviewer's own words (requestMoreInfo). The reviewer's message and items are shown as written;
 * the frame says who is asking, in the family's language.
 */
export function familyRequestEmailCopy(locale: VerificationLocale, orgName: string): FamilyRequestEmailCopy {
  if (locale === "es") {
    return {
      subject: `${orgName} necesita algo más para revisar sus ingresos`,
      heading: "Necesitamos un poco más de información",
      intro: `Una persona de ${orgName} revisó su información y le pide lo siguiente:`,
      itemsHeading: "Lo que se pide",
      cta: "Continuar",
    };
  }
  return {
    subject: `${orgName} needs something more to check your income`,
    heading: "We need a little more information",
    intro: `A person at ${orgName} looked at your information and asks for the following:`,
    itemsHeading: "What is asked for",
    cta: "Continue",
  };
}

/* ------------------------------------------------------------------------------------- family view */

export type FamilyStep = "consent" | "household" | "evidence" | "waiting" | "outcome";
export type Bilingual = { en: string; es: string };

export const FAMILY_STEP_LABELS: Readonly<Record<FamilyStep, Bilingual>> = Object.freeze({
  consent: { en: "Give permission", es: "Dar permiso" },
  household: { en: "Tell us about your household", es: "Información de su hogar" },
  evidence: { en: "Share proof of income", es: "Compartir comprobantes de ingresos" },
  waiting: { en: "We are checking", es: "Estamos revisando" },
  outcome: { en: "Result", es: "Resultado" },
});

/** Plain-language status of one document, as the family sees it. */
export type FamilyDocumentState = "reading" | "received" | "needs_person" | "checked_by_person" | "cannot_use" | "removed" | "deleted_after_decision" | "carried_over";

export const FAMILY_DOCUMENT_STATE_LABELS: Readonly<Record<FamilyDocumentState, Bilingual>> = Object.freeze({
  reading: { en: "Received — we are reading it", es: "Recibido — lo estamos leyendo" },
  received: { en: "Received", es: "Recibido" },
  needs_person: { en: "We could not read this — a person will look at it", es: "No pudimos leer esto — una persona lo revisará" },
  checked_by_person: { en: "Checked by a person", es: "Revisado por una persona" },
  cannot_use: { en: "We cannot use this document", es: "No podemos usar este documento" },
  removed: { en: "Removed", es: "Quitado" },
  deleted_after_decision: { en: "File deleted after the decision (we keep a fingerprint of it)", es: "Archivo borrado después de la decisión (guardamos una huella digital)" },
  carried_over: { en: "From your earlier verification", es: "De su verificación anterior" },
});

/** "What happens next", by where the verification is. Never promises an award. */
export function familyNextSteps(state: "evidence" | "waiting" | "in_review" | "awaiting_family" | "eligible" | "ineligible" | "closed", orgName: string): Bilingual {
  const notAPromise: Bilingual = {
    en: "The scholarship organization decides awards. Being eligible is not a promise of a scholarship.",
    es: "La organización de becas decide las becas. Ser elegible no es una promesa de beca.",
  };
  switch (state) {
    case "evidence":
      return {
        en: `When you have shared what you can, press submit. We check the income requirement and send the result to ${orgName}. ${notAPromise.en}`,
        es: `Cuando haya compartido lo que pueda, presione enviar. Revisamos el requisito de ingresos y enviamos el resultado a ${orgName}. ${notAPromise.es}`,
      };
    case "waiting":
      return {
        en: `We are reading what you shared. We will email you when there is a result or if we need anything else. ${notAPromise.en}`,
        es: `Estamos leyendo lo que compartió. Le enviaremos un correo cuando haya un resultado o si necesitamos algo más. ${notAPromise.es}`,
      };
    case "in_review":
      return {
        en: `A person at ${orgName} is looking at your information. You do not need to do anything now; we will email you. ${notAPromise.en}`,
        es: `Una persona de ${orgName} está revisando su información. No tiene que hacer nada por ahora; le enviaremos un correo. ${notAPromise.es}`,
      };
    case "awaiting_family":
      return {
        en: `Add what is listed below and press submit again. Everything you already shared is kept. ${notAPromise.en}`,
        es: `Agregue lo que se indica abajo y presione enviar otra vez. Todo lo que ya compartió se guarda. ${notAPromise.es}`,
      };
    case "eligible":
      return {
        en: `${orgName} has the result. ${notAPromise.en}`,
        es: `${orgName} tiene el resultado. ${notAPromise.es}`,
      };
    case "ineligible":
      return {
        en: `${orgName} has the result. If you think something is wrong, contact ${orgName}.`,
        es: `${orgName} tiene el resultado. Si cree que algo está mal, comuníquese con ${orgName}.`,
      };
    case "closed":
      return {
        en: `This verification is closed. Contact ${orgName} if you still need to verify your income.`,
        es: `Esta verificación está cerrada. Comuníquese con ${orgName} si todavía necesita verificar sus ingresos.`,
      };
  }
}
