/**
 * Plain-language explanations of a decision, for two audiences.
 *
 *  - `family`: for the household's own screen. Warm, short, no jargon. It never shows an income figure, for
 *    the household or for any member: a figure may come from one adult's payroll connection or tax record,
 *    and the person reading the screen is not necessarily that adult. It shows the limit (a public number)
 *    only when the limit is a single figure.
 *  - `sgo`: for the SGO dashboard. Precise: the method and its citation, the limit with every reading, the
 *    recorded income, coverage, and what a reviewer has to settle. It names no household member; reasons
 *    refer to people only by id.
 *
 * Copy rules these sentences follow (docs/architecture.md): proposed-regulation content is "under the
 * proposed rules", never settled law; nothing says or implies that the IRS limitation table has been
 * published while the table in use is HUD-derived; a verified income requirement is never called an award;
 * and the provisional note is always present while the limit is HUD-derived.
 */
import { describeThresholdSource, getTable } from "@/engine/ami";
import { formatLongDate } from "@/engine/income";
import { formatUsd } from "@/lib/money";
import { CATEGORICAL_PROGRAM_LABELS } from "./categorical";
import { formatBps } from "./direct";
import { CUSTODY_REVIEW_CODES, LETTER_AMBIGUOUS_CODES, type Decision, type LetterDisqualifyingCode } from "./types";

export type ExplanationLocale = "en" | "es";

/** Bump when any sentence in this file changes. */
export const DECISION_EXPLANATION_COPY_VERSION = "decision-explanation-copy.v1";

export interface DecisionExplanation {
  locale: ExplanationLocale;
  copyVersion: string;
  /** For the household's own screen. */
  family: {
    headline: string;
    paragraphs: string[];
    /** What the household still has to provide, one sentence each; empty unless the decision is pending. */
    missing: string[];
  };
  /** For SGO staff. */
  sgo: {
    headline: string;
    paragraphs: string[];
    /** Why the decision is what it is, one entry per reason. */
    reasons: string[];
    /** What a reviewer has to settle, one entry per point. */
    reviewPoints: string[];
  };
}

type Copy<T> = Record<ExplanationLocale, T>;

const FAMILY_HEADLINE: Copy<Record<Decision["status"], string>> = {
  en: {
    eligible: "Your household meets the income requirement",
    ineligible: "Your household's income is above the limit",
    needs_review: "Your information is being reviewed",
    pending: "We need a little more information",
  },
  es: {
    eligible: "Su hogar cumple con el requisito de ingresos",
    ineligible: "Los ingresos de su hogar superan el límite",
    needs_review: "Su información está en revisión",
    pending: "Necesitamos un poco más de información",
  },
};

const NOT_AN_AWARD: Copy<string> = {
  en: "This confirms one requirement only. It is not a scholarship award: the scholarship organization decides awards separately.",
  es: "Esto confirma solo un requisito. No es la adjudicación de una beca: la organización de becas decide las adjudicaciones por separado.",
};

const PROVISIONAL_FALLBACK: Copy<{ family: string; sgo: (version: string, date: string) => string }> = {
  en: {
    family: "The income limit used here is provisional. It is based on figures HUD publishes for your area. The IRS has said it expects to publish official limits; when those are in use, they replace this figure.",
    sgo: (version, date) => `The limit is provisional: it is HUD-derived (table ${version}, effective ${date}) and is not an IRS-published limit.`,
  },
  es: {
    family:
      "El límite de ingresos usado aquí es provisional. Se basa en cifras que HUD publica para su área. El IRS ha indicado que prevé publicar límites oficiales; cuando estén en uso, reemplazarán esta cifra.",
    sgo: (version, date) => `El límite es provisional: se deriva de HUD (tabla ${version}, vigente desde el ${date}) y no es un límite publicado por el IRS.`,
  },
};

const UNUSABLE_LETTER: Copy<Record<LetterDisqualifyingCode, string>> = {
  en: {
    program_medicaid_not_listed: "The letter you uploaded is for Medicaid. Under the proposed rules, only a letter for SNAP, TANF, WIC, Section 8 housing or SSI can be used this way.",
    program_chip_not_listed: "The letter you uploaded is for CHIP. Under the proposed rules, only a letter for SNAP, TANF, WIC, Section 8 housing or SSI can be used this way.",
    program_ssdi_rsdi_not_listed:
      "The letter you uploaded is for Social Security retirement, survivors or disability benefits. Under the proposed rules, only a letter for SNAP, TANF, WIC, Section 8 housing or SSI can be used this way.",
    program_school_meals_not_accepted: "The letter you uploaded is about free or reduced-price school meals. Under the proposed rules, school meal eligibility cannot be used this way.",
    program_not_listed: "The letter you uploaded is for a program that cannot be used this way. Under the proposed rules, only a letter for SNAP, TANF, WIC, Section 8 housing or SSI can be used.",
    letter_shows_denial: "The letter you uploaded shows a denial, not an approval.",
    letter_shows_termination: "The letter you uploaded shows that the benefits ended.",
    letter_shows_pending_application: "The letter you uploaded shows an application that is still being processed, not an approval.",
    letter_older_than_12_months: "The letter you uploaded is dated more than 12 months ago. A more recent letter can be used.",
  },
  es: {
    program_medicaid_not_listed: "La carta que subió es de Medicaid. Según las reglas propuestas, solo una carta de SNAP, TANF, WIC, vivienda de la Sección 8 o SSI puede usarse de esta manera.",
    program_chip_not_listed: "La carta que subió es de CHIP. Según las reglas propuestas, solo una carta de SNAP, TANF, WIC, vivienda de la Sección 8 o SSI puede usarse de esta manera.",
    program_ssdi_rsdi_not_listed:
      "La carta que subió es de beneficios del Seguro Social por jubilación, sobrevivientes o discapacidad. Según las reglas propuestas, solo una carta de SNAP, TANF, WIC, vivienda de la Sección 8 o SSI puede usarse de esta manera.",
    program_school_meals_not_accepted:
      "La carta que subió es sobre comidas escolares gratuitas o a precio reducido. Según las reglas propuestas, la elegibilidad para comidas escolares no puede usarse de esta manera.",
    program_not_listed: "La carta que subió es de un programa que no puede usarse de esta manera. Según las reglas propuestas, solo puede usarse una carta de SNAP, TANF, WIC, vivienda de la Sección 8 o SSI.",
    letter_shows_denial: "La carta que subió muestra una denegación, no una aprobación.",
    letter_shows_termination: "La carta que subió muestra que los beneficios terminaron.",
    letter_shows_pending_application: "La carta que subió muestra una solicitud que todavía está en trámite, no una aprobación.",
    letter_older_than_12_months: "La carta que subió tiene fecha de hace más de 12 meses. Puede usarse una carta más reciente.",
  },
};

const OTHER_INCOME_LABEL: Copy<Record<"evidence_provided" | "certified_none" | "missing", string>> = {
  en: { evidence_provided: "evidence provided", certified_none: "certified as none", missing: "neither evidence nor a certification" },
  es: { evidence_provided: "se presentó evidencia", certified_none: "certificado como ninguno", missing: "ni evidencia ni certificación" },
};

function provisionalNotes(decision: Decision, locale: ExplanationLocale): { family: string | null; sgo: string } {
  const { tableVersion, effectiveDate, provisional } = decision.thresholdTable;
  const date = formatLongDate(effectiveDate, locale);
  try {
    // The AMI engine owns the wording shown next to a threshold; use it whenever the table is installed.
    const description = describeThresholdSource(getTable(tableVersion), locale);
    return { family: provisional ? description.familyNote : null, sgo: description.sourceLine };
  } catch {
    if (provisional) return { family: PROVISIONAL_FALLBACK[locale].family, sgo: PROVISIONAL_FALLBACK[locale].sgo(tableVersion, date) };
    return {
      family: null,
      sgo: locale === "es" ? `El límite proviene de la tabla publicada por el IRS (tabla ${tableVersion}, vigente desde el ${date}).` : `The limit is from the IRS-published table (table ${tableVersion}, effective ${date}).`,
    };
  }
}

function familyExplanation(decision: Decision, locale: ExplanationLocale, provisionalNote: string | null): DecisionExplanation["family"] {
  const es = locale === "es";
  const paragraphs: string[] = [];
  const { status, incomeYear, threshold } = decision;
  const byReviewer = decision.decidedBy.type === "reviewer";
  const size = decision.householdSize;
  const where =
    threshold && size !== null
      ? es
        ? ` para un hogar de ${size} ${size === 1 ? "persona" : "personas"} en ${threshold.county.name}`
        : ` for a household of ${size} in ${threshold.county.name}`
      : "";
  // A single figure only. When the readings differ, a dollar amount would promise more than is known.
  const singleLimit = threshold && threshold.readingsAgree ? formatUsd(threshold.lowerBoundCents) : null;
  const limitSentence = !singleLimit
    ? null
    : es
      ? `El límite${decision.provisional ? " provisional" : ""}${where} es de ${singleLimit}.`
      : `The ${decision.provisional ? "provisional limit" : "limit"}${where} is ${singleLimit}.`;
  const unusableLetters = decision.letters
    .filter((letter) => letter.outcome === "fail")
    .map((letter) => letter.defects.find((defect) => defect.kind === "disqualifying"))
    .filter((defect) => defect !== undefined)
    .map((defect) => UNUSABLE_LETTER[locale][defect.code as LetterDisqualifyingCode]);

  if (status === "eligible") {
    if (byReviewer) {
      paragraphs.push(
        es
          ? "Una persona de la organización de becas revisó su información y confirmó que su hogar cumple con el requisito de ingresos."
          : "A reviewer at the scholarship organization looked at your information and confirmed that your household meets the income requirement.",
      );
    } else if (decision.method === "categorical" && decision.awardProgram && decision.awardLetterDate) {
      const program = CATEGORICAL_PROGRAM_LABELS[decision.awardProgram][locale];
      const date = formatLongDate(decision.awardLetterDate, locale);
      paragraphs.push(es ? `Lo confirmamos con la carta de aprobación de ${program} con fecha del ${date}.` : `We confirmed this with the ${program} approval letter dated ${date}.`);
    } else {
      paragraphs.push(
        es
          ? `Los documentos que compartió muestran que los ingresos de su hogar en ${incomeYear} están dentro del límite de ingresos${where}.`
          : `The documents you shared show that your household's ${incomeYear} income is within the income limit${where}.`,
      );
      if (limitSentence) paragraphs.push(limitSentence);
    }
    paragraphs.push(NOT_AN_AWARD[locale]);
    if (decision.validUntil) {
      const until = formatLongDate(decision.validUntil, locale);
      paragraphs.push(es ? `Este resultado puede usarse hasta el ${until}.` : `This result can be used until ${until}.`);
    }
  } else if (status === "ineligible") {
    paragraphs.push(
      byReviewer
        ? es
          ? `Una persona de la organización de becas revisó su información y determinó que los ingresos de su hogar en ${incomeYear} superan el límite de ingresos${where}.`
          : `A reviewer at the scholarship organization looked at your information and found that your household's ${incomeYear} income is above the income limit${where}.`
        : es
          ? `Los documentos que compartió muestran que los ingresos de su hogar en ${incomeYear} superan el límite de ingresos${where}.`
          : `The documents you shared show that your household's ${incomeYear} income is above the income limit${where}.`,
    );
    if (limitSentence) paragraphs.push(limitSentence);
    paragraphs.push(...unusableLetters);
    paragraphs.push(
      es
        ? "Si cree que falta algo o que hay un error, comuníquese con la organización de becas. Puede compartir más documentos y pedir otra revisión."
        : "If you think something is missing or wrong, contact the scholarship organization. You can share more documents and ask for another look.",
    );
  } else if (status === "needs_review") {
    paragraphs.push(
      es
        ? "Una persona de la organización de becas necesita revisar su información antes de tomar una decisión. No tiene que hacer nada por ahora. Se comunicarán con usted si necesitan algo más."
        : "A person at the scholarship organization needs to look at your information before a decision is made. You do not need to do anything right now. They will contact you if they need something more.",
    );
    const codes = new Set<string>(decision.reviewReasons.map((reason) => reason.code));
    if (LETTER_AMBIGUOUS_CODES.some((code) => codes.has(code))) {
      paragraphs.push(es ? "Revisarán la carta de aprobación que usted subió." : "They will look at the approval letter you uploaded.");
    }
    if (CUSTODY_REVIEW_CODES.some((code) => codes.has(code))) {
      paragraphs.push(es ? `Revisarán sus respuestas sobre dónde vivió el estudiante durante ${incomeYear}.` : `They will look at your answers about where the student lived during ${incomeYear}.`);
    }
  } else {
    paragraphs.push(
      es
        ? "Todavía no podemos terminar de verificar el requisito de ingresos. Esto es lo que aún necesitamos de usted."
        : "We cannot finish checking the income requirement yet. Here is what we still need from you.",
    );
    paragraphs.push(...unusableLetters);
  }

  if (provisionalNote) paragraphs.push(provisionalNote);
  return { headline: FAMILY_HEADLINE[locale][status], paragraphs, missing: decision.missing.map((item) => item.message[locale]) };
}

function sgoExplanation(decision: Decision, locale: ExplanationLocale, sourceLine: string): DecisionExplanation["sgo"] {
  const es = locale === "es";
  const paragraphs: string[] = [];
  const { status, method, incomeYear, threshold, income, coverage } = decision;
  const methodName = method === "categorical" ? (es ? "método categórico" : "categorical method") : es ? "método directo" : "direct method";

  const headline =
    status === "eligible"
      ? es
        ? `Elegible: ${methodName}`
        : `Eligible: ${methodName}`
      : status === "ineligible"
        ? es
          ? `No elegible: ${methodName}`
          : `Ineligible: ${methodName}`
        : status === "needs_review"
          ? es
            ? "Requiere revisión"
            : "Needs review"
          : es
            ? "Pendiente: en espera del hogar"
            : "Pending: waiting on the household";

  if (decision.decidedBy.type === "reviewer") {
    const { reviewerId, resolvedOn, notes } = decision.decidedBy;
    paragraphs.push(
      es
        ? `Resuelto por un revisor (${reviewerId}) el ${formatLongDate(resolvedOn, locale)} como ${status === "eligible" ? "elegible" : "no elegible"}, con base en el ${methodName} (${decision.methodCitation}). Notas del revisor: ${notes}`
        : `Resolved by a reviewer (${reviewerId}) on ${formatLongDate(resolvedOn, locale)} as ${status}, relying on the ${methodName} (${decision.methodCitation}). Reviewer notes: ${notes}`,
    );
  } else if (status === "eligible" && method === "categorical" && decision.awardProgram && decision.awardLetterDate) {
    const program = CATEGORICAL_PROGRAM_LABELS[decision.awardProgram][locale];
    const date = formatLongDate(decision.awardLetterDate, locale);
    paragraphs.push(
      es
        ? `El requisito de ingresos del hogar se cumple mediante el método categórico (${decision.methodCitation}): una carta de aprobación con fecha del ${date} muestra que un miembro del hogar tiene aprobación vigente de ${program}.`
        : `The household income requirement is met through the categorical method (${decision.methodCitation}): an award letter dated ${date} shows that a member of the household is currently approved for ${program}.`,
    );
  } else if (status === "eligible") {
    paragraphs.push(
      es
        ? `El requisito de ingresos del hogar se cumple mediante el método directo (${decision.methodCitation}): los ingresos registrados del hogar en ${incomeYear} no superan el límite.`
        : `The household income requirement is met through the direct method (${decision.methodCitation}): recorded household income for ${incomeYear} is not greater than the limit.`,
    );
  } else if (status === "ineligible") {
    paragraphs.push(
      es
        ? `Los ingresos registrados del hogar en ${incomeYear} superan el límite según todas las lecturas, y los ingresos de cada adulto están documentados (método directo, ${decision.methodCitation}).`
        : `Recorded household income for ${incomeYear} is greater than the limit under every reading, and every adult's income is documented (direct method, ${decision.methodCitation}).`,
    );
  } else if (status === "needs_review") {
    const count = decision.reviewReasons.length;
    paragraphs.push(
      es
        ? `Esta verificación necesita un revisor: ${count === 1 ? "hay un punto" : `hay ${count} puntos`} por resolver antes de decidir el requisito de ingresos. Nada se ha decidido.`
        : `This verification needs a reviewer: ${count === 1 ? "one point has" : `${count} points have`} to be settled before the income requirement can be decided. Nothing has been decided.`,
    );
  } else {
    const count = decision.missing.length;
    paragraphs.push(
      es
        ? `Esta verificación espera ${count === 1 ? "un elemento" : `${count} elementos`} del hogar. Nada se ha decidido.`
        : `This verification is waiting on the household for ${count === 1 ? "one item" : `${count} items`}. Nothing has been decided.`,
    );
  }

  /* Household and limit. */
  const applied = formatLongDate(decision.applicationDate, locale);
  if (threshold) {
    paragraphs.push(
      es
        ? `Hogar de ${threshold.householdSize} en ${threshold.county.name} (${threshold.area.name}). Año de ingresos ${incomeYear}; solicitud con fecha del ${applied}.`
        : `Household of ${threshold.householdSize} in ${threshold.county.name} (${threshold.area.name}). Income year ${incomeYear}; application dated ${applied}.`,
    );
    const cap = `${threshold.capPct}%`;
    if (threshold.readingsAgree) {
      paragraphs.push(es ? `Límite con el tope de ${cap} de la organización: ${formatUsd(threshold.lowerBoundCents)}.` : `Limit at the SGO's cap of ${cap}: ${formatUsd(threshold.lowerBoundCents)}.`);
    } else {
      const readings = threshold.readings.map((reading) => `${reading.label}: ${formatUsd(reading.thresholdCents)}`).join("; ");
      paragraphs.push(
        es
          ? `Las reglas propuestas pueden leerse de dos maneras, que dan límites distintos para este condado y tamaño de hogar con el tope de ${cap}: ${readings}. No se sabe cuál de las dos lecturas seguirán los límites que publique el IRS, si es que siguen alguna, así que solo se decide automáticamente cuando ambas lecturas coinciden.`
          : `The proposed rules can be read two ways, which give different limits for this county and household size at the SGO's cap of ${cap}: ${readings}. It is not known which reading, if either, the IRS-published limits will follow, so automatic decisions are made only where both readings agree.`,
      );
    }
    if (threshold.reviewBand.applied) {
      const from = formatUsd(threshold.autoEligibleMaxCents + 1);
      const to = formatUsd(threshold.autoIneligibleAboveCents);
      const band = formatBps(threshold.reviewBand.bps);
      paragraphs.push(
        es
          ? `Mientras el límite sea provisional, los ingresos de ${from} a ${to} pasan a un revisor (banda de revisión de ${band}).`
          : `While the limit is provisional, income from ${from} to ${to} goes to a reviewer (review band of ${band}).`,
      );
    }
  } else {
    paragraphs.push(es ? `Año de ingresos ${incomeYear}; solicitud con fecha del ${applied}. No hay un límite de ingresos registrado todavía.` : `Income year ${incomeYear}; application dated ${applied}. No income limit is on record yet.`);
  }

  /* Income. Under the categorical method no income detail is repeated: the method exists to avoid collecting it. */
  if (income && coverage && method !== "categorical") {
    const range =
      income.lowerBoundCents === income.upperBoundCents
        ? ""
        : es
          ? ` (entre ${formatUsd(income.lowerBoundCents)} y ${formatUsd(income.upperBoundCents)} según puntos que las fuentes dejan abiertos)`
          : ` (between ${formatUsd(income.lowerBoundCents)} and ${formatUsd(income.upperBoundCents)} depending on points the sources leave open)`;
    const certified = coverage.certifiedZeroIncomeMemberCount;
    paragraphs.push(
      es
        ? `Ingresos registrados del hogar en ${incomeYear}: ${formatUsd(income.totalCountedCents)}${range}. Cobertura: ${coverage.documentedMemberCount} de ${coverage.requiredMemberCount} adultos con ingresos documentados${certified > 0 ? `, ${certified} con declaración firmada de no tener ingresos` : ""}; otros ingresos: ${OTHER_INCOME_LABEL.es[coverage.otherIncome]}.`
        : `Recorded household income for ${incomeYear}: ${formatUsd(income.totalCountedCents)}${range}. Coverage: ${coverage.documentedMemberCount} of ${coverage.requiredMemberCount} adults with documented income${certified > 0 ? `, ${certified} with a signed statement of no income` : ""}; other income: ${OTHER_INCOME_LABEL.en[coverage.otherIncome]}.`,
    );
  }

  if (decision.validUntil) {
    const until = formatLongDate(decision.validUntil, locale);
    paragraphs.push(
      es
        ? `El resultado puede reutilizarse hasta el ${until}. Verificar el requisito de ingresos no es adjudicar una beca: la adjudicación es una decisión aparte de la organización.`
        : `The result can be reused through ${until}. Verifying the income requirement is not an award: an award is a separate decision by the SGO.`,
    );
  }
  paragraphs.push(sourceLine);

  return {
    headline,
    paragraphs,
    reasons: decision.reasons.map((reason) => reason.message),
    reviewPoints: decision.reviewReasons.map((reason) => reason.message),
  };
}

/**
 * Short plain-language paragraphs for the family screen and for the SGO dashboard.
 *
 * `sgo.reasons` and `sgo.reviewPoints` are the engine's English reason messages in both locales; the
 * headline and paragraphs are translated.
 */
export function explainDecision(decision: Decision, locale: ExplanationLocale): DecisionExplanation {
  const notes = provisionalNotes(decision, locale);
  return {
    locale,
    copyVersion: DECISION_EXPLANATION_COPY_VERSION,
    family: familyExplanation(decision, locale, notes.family),
    sgo: sgoExplanation(decision, locale, notes.sgo),
  };
}
