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

/* ----------------------------------------------------------------------------------------- reviewer */

export interface ReviewerEmailCopy {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta: string;
}

/** SGO-facing, English. Names no household member and shows no figure: details are behind sign-in. */
export function reviewerEmailCopy(input: { verificationId: string; externalRef: string | null; reasonCount: number; mode: "test" | "live" }): ReviewerEmailCopy {
  const ref = input.externalRef ? ` (your reference ${input.externalRef})` : "";
  return {
    subject: `${input.mode === "test" ? "[Test] " : ""}A verification needs review`,
    heading: "A verification needs review",
    paragraphs: [
      `Verification ${input.verificationId}${ref} needs a reviewer before it can be decided.`,
      `${input.reasonCount === 1 ? "There is 1 point" : `There are ${input.reasonCount} points`} to settle. Sign in to the dashboard to see them.`,
    ],
    cta: "Open in the dashboard",
  };
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
