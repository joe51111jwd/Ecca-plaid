import { PROPOSED_RULE_ID, STATUTORY_CAP_PCT, THRESHOLD_COPY_VERSION } from "./constants";
import { formatExactUsd, formatLongDate } from "./format";
import type {
  AmiTable,
  ThresholdCopyLocale,
  ThresholdReadingId,
  ThresholdReadingsDescription,
  ThresholdResult,
  ThresholdSource,
  ThresholdSourceDescription,
} from "./types";

/**
 * The exact words every surface (API, dashboard, evidence PDF, family screen) shows next to a threshold.
 *
 * Rules these sentences are written to satisfy:
 *  - A HUD-derived limit is always called provisional and is never called an IRS limit.
 *  - Nothing says or implies that the IRS limitation table has been published while the table in use is
 *    HUD-derived. The provisional wording describes only what this figure is and what the IRS has said it
 *    anticipates doing, so it stays true on the day the IRS publishes and before the swap-in is deployed.
 *  - The calculation is attributed to the notice of proposed rulemaking and the rules are called not final.
 *  - While the table is HUD-derived, neither reading of the proposed rule is presented as the IRS's choice;
 *    no source says which one the IRS will use (docs/reference/sgo-verification-rules.md F34).
 *
 * Components must render these strings as they are. To change a sentence, change it here and bump
 * `THRESHOLD_COPY_VERSION`.
 */

const SOURCE_NAME: Record<ThresholdCopyLocale, Record<ThresholdSource, string>> = {
  en: { hud_provisional: "HUD-derived (provisional)", irs_published: "IRS-published" },
  es: { hud_provisional: "Derivado de HUD (provisional)", irs_published: "Publicado por el IRS" },
};

/** Short display name for a `threshold_source` value. */
export function thresholdSourceName(source: ThresholdSource, locale: ThresholdCopyLocale = "en"): string {
  return SOURCE_NAME[locale][source];
}

const READINGS_NOTE: Record<ThresholdCopyLocale, string> = {
  en:
    "The proposed rule can be read two ways: 300 percent of HUD's area median income times the family-size multiplier, " +
    "or six times HUD's Section 8 very-low-income limit for the family size. Which one the IRS will use is not yet known. " +
    "Where the two give different limits, automatic decisions use the lower figure to approve and the higher figure to decline; " +
    "incomes in between are reviewed by a person.",
  es:
    "La regla propuesta admite dos lecturas: el 300 por ciento del ingreso medio del área de HUD multiplicado por el factor por tamaño de la familia, " +
    "o seis veces el límite de ingresos muy bajos de la Sección 8 de HUD para el tamaño de la familia. Todavía no se sabe cuál usará el IRS. " +
    "Cuando las dos dan límites distintos, las decisiones automáticas usan la cifra menor para aprobar y la mayor para rechazar; " +
    "los ingresos que quedan entre ambas los revisa una persona.",
};

function readingIdsOf(table: AmiTable): ThresholdReadingId[] {
  return table.dataset.source === "hud_provisional" ? ["median_product", "section8_vli"] : ["irs_published"];
}

export function describeThresholdSource(table: AmiTable, locale: ThresholdCopyLocale = "en"): ThresholdSourceDescription {
  const dataset = table.dataset;
  const date = formatLongDate(dataset.effectiveDate, locale);
  const common = {
    copyVersion: THRESHOLD_COPY_VERSION,
    locale,
    source: dataset.source,
    provisional: table.provisional,
    tableVersion: dataset.version,
    effectiveDate: dataset.effectiveDate,
    readingIds: readingIdsOf(table),
    readingsNote: dataset.source === "hud_provisional" ? READINGS_NOTE[locale] : null,
  };

  if (dataset.source === "hud_provisional") {
    const fy = dataset.fiscalYear;
    if (locale === "es") {
      return {
        ...common,
        badge: "Provisional",
        limitLabel: "Límite de ingresos provisional (derivado de HUD)",
        sourceLine: `Límite provisional derivado de HUD, calculado con el ingreso familiar medio del área del año fiscal ${fy} de HUD (vigente desde el ${date}). No es un límite publicado por el IRS.`,
        explanation:
          `Este límite de ingresos es provisional. Se calcula con el ingreso familiar medio del área del año fiscal ${fy} de HUD (vigente desde el ${date}) y el ajuste de HUD por tamaño de la familia, ` +
          `con el cálculo descrito en el aviso de reglamentación propuesta (${PROPOSED_RULE_ID}): el ${STATUTORY_CAP_PCT} por ciento del ingreso bruto medio del área multiplicado por el factor por tamaño de la familia. ` +
          `Las reglas propuestas no son definitivas. No es un límite publicado por el IRS. El IRS ha indicado que prevé publicar los límites aplicables por área geográfica y tamaño de la familia en el Internal Revenue Bulletin; ` +
          `los límites publicados por el IRS reemplazarán esta cifra provisional cuando estén en uso. Versión de la tabla: ${dataset.version}.`,
        familyNote:
          "Este límite de ingresos es provisional. Se basa en el ingreso medio que HUD publica para su área y en el tamaño de su hogar. " +
          "El IRS ha indicado que prevé publicar límites oficiales; cuando estén en uso, reemplazarán esta cifra.",
      };
    }
    return {
      ...common,
      badge: "Provisional",
      limitLabel: "Provisional income limit (HUD-derived)",
      sourceLine: `Provisional, HUD-derived limit computed from HUD FY ${fy} area median family income (effective ${date}). This is not an IRS-published limit.`,
      explanation:
        `This income limit is provisional. It is computed from the HUD FY ${fy} area median family income (effective ${date}) and the HUD family-size adjustment, ` +
        `using the calculation described in the notice of proposed rulemaking (${PROPOSED_RULE_ID}): ${STATUTORY_CAP_PCT} percent of area median gross income multiplied by the family-size multiplier. ` +
        `The proposed rules are not final. This is not an IRS-published limit. The IRS has said it anticipates publishing the applicable limits by geographic area and family size in the Internal Revenue Bulletin; ` +
        `IRS-published limits replace this provisional figure once they are in use. Table version: ${dataset.version}.`,
      familyNote:
        "This income limit is provisional. It is based on the median income HUD publishes for your area and on your household size. " +
        "The IRS has said it expects to publish official limits; when those are in use, they replace this number.",
    };
  }

  const citation = dataset.citation;
  if (locale === "es") {
    return {
      ...common,
      badge: "Publicado por el IRS",
      limitLabel: "Límite de ingresos (publicado por el IRS)",
      sourceLine: `Límite publicado por el IRS (${citation ?? "Internal Revenue Bulletin"}), vigente desde el ${date}.`,
      explanation:
        `Este límite de ingresos proviene de la tabla de límites que el IRS publicó en el Internal Revenue Bulletin${citation ? ` (${citation})` : ""}, vigente desde el ${date}, ` +
        `para el área geográfica y el tamaño de la familia del hogar. Versión de la tabla: ${dataset.version}.`,
      familyNote: "Este límite de ingresos proviene de la tabla que el IRS publica para su área y el tamaño de su hogar.",
    };
  }
  return {
    ...common,
    badge: "IRS-published",
    limitLabel: "Income limit (IRS-published)",
    sourceLine: `IRS-published limit (${citation ?? "Internal Revenue Bulletin"}), effective ${date}.`,
    explanation:
      `This income limit is taken from the limitation table the IRS published in the Internal Revenue Bulletin${citation ? ` (${citation})` : ""}, effective ${date}, ` +
      `for the household's geographic area and family size. Table version: ${dataset.version}.`,
    familyNote: "This income limit comes from the table the IRS publishes for your area and household size.",
  };
}

const READING_NAME: Record<ThresholdCopyLocale, Record<ThresholdReadingId, string>> = {
  en: {
    median_product: "Area median income x family-size multiplier (the worked example in the proposed rule's economic analysis)",
    section8_vli: "6 x HUD's Section 8 very-low-income limit (a reading of the proposed regulation text)",
    irs_published: "IRS-published limit",
  },
  es: {
    median_product: "Ingreso medio del área x factor por tamaño de la familia (el ejemplo del análisis económico de la regla propuesta)",
    section8_vli: "6 x el límite de ingresos muy bajos de la Sección 8 de HUD (una lectura del texto de la regla propuesta)",
    irs_published: "Límite publicado por el IRS",
  },
};

/** Plain-language name of a reading. Never implies the IRS has adopted a provisional reading. */
export function thresholdReadingLabel(id: ThresholdReadingId, locale: ThresholdCopyLocale = "en"): string {
  return READING_NAME[locale][id];
}

/**
 * The exact sentences a surface shows next to one result's limit, including the review band when the two
 * provisional readings differ. `readingLines` carry each reading's arithmetic (written in English figures).
 */
export function describeReadings(result: ThresholdResult, locale: ThresholdCopyLocale = "en"): ThresholdReadingsDescription {
  const readingLines = result.readings.map((reading) => `${READING_NAME[locale][reading.id]}: ${reading.formula}`);
  const lower = formatExactUsd(result.lowerBoundCents);
  const upper = formatExactUsd(result.upperBoundCents);
  const base = { copyVersion: THRESHOLD_COPY_VERSION, locale, readingLines };

  if (!result.provisional) {
    const summary =
      locale === "es"
        ? `Límite publicado por el IRS para este condado y tamaño del hogar: ${lower}.`
        : `IRS-published limit for this county and household size: ${lower}.`;
    return { ...base, status: "single", summary };
  }
  if (result.readingsAgree) {
    const summary =
      locale === "es"
        ? `Provisional. Las dos lecturas de la regla propuesta dan el mismo límite para este condado y tamaño del hogar: ${lower}.`
        : `Provisional. Both readings of the proposed rule give the same limit for this county and household size: ${lower}.`;
    return { ...base, status: "agree", summary };
  }
  const summary =
    locale === "es"
      ? `Provisional. Dos lecturas de la regla propuesta dan límites distintos para este condado y tamaño del hogar: ${lower} y ${upper}. ` +
        "Las decisiones automáticas usan la cifra menor para aprobar y la mayor para rechazar; los ingresos que quedan entre ambas los revisa una persona."
      : `Provisional. Two readings of the proposed rule give different limits for this county and household size: ${lower} and ${upper}. ` +
        "Automatic decisions use the lower figure to approve and the higher figure to decline; incomes in between are reviewed by a person.";
  return { ...base, status: "differ", summary };
}
