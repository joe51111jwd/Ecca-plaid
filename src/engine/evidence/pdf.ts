import { sha256Hex } from "@/lib/crypto";
import { invalid } from "@/lib/errors";
import {
  ACTOR_LABEL,
  APPROVAL_LABEL,
  COUNTY_RESOLUTION_LABEL,
  DOCUMENT_KIND_LABEL,
  DOCUMENT_TITLE,
  EXTRACTOR_LABEL,
  INCOME_SOURCE_LABEL,
  INCOME_TREATMENT_LABEL,
  MEMBER_ROLE_LABEL,
  METHOD_BASIS_LABEL,
  PDF_COPY,
  RAIL_KIND_LABEL,
  STATUS_DETAIL,
  STATUS_LABEL,
  consentKindLabel,
  custodyOutcomeLabel,
} from "./copy";
import { formatBytes, formatCalendarDate, formatMoney, formatUtcClock, formatUtcTimestamp, groupHash, humanizeKey, utcDateOf } from "./format";
import { COLOR, CONTENT_WIDTH, PdfWriter, STYLE, type Cell, type CellPart, type Column, type TextStyle } from "./pdf-layout";
import { canonicalRecordBytes } from "./record";
import {
  EVIDENCE_SCHEMA_VERSION,
  type EvidencePdfOptions,
  type EvidenceRecordActor,
  type EvidenceRecordConsent,
  type EvidenceScopeValue,
  type EvidenceStatus,
  type SignedEvidence,
} from "./types";

/**
 * The human-readable evidence pack: a rendering of a signed record as a US Letter PDF an auditor can read
 * front to back.
 *
 * The PDF is a pure function of the signed record and the two options. Rendering the same input twice gives
 * the same bytes: dates in the file come from the record's `generated_at`, the producer string is fixed, and
 * nothing reads a clock. Because the bytes are reproducible, anyone holding the signed JSON can re-render the
 * PDF and compare hashes.
 */

/** Written into the PDF's Producer field. Changing the layout changes the bytes, so the version is part of it. */
export const EVIDENCE_PDF_RENDERER = "evidence-pdf.v1";

const STATUS_COLOR: Readonly<Record<EvidenceStatus, TextStyle["color"]>> = { eligible: COLOR.green, ineligible: COLOR.red, needs_review: COLOR.amber };

const MONO: TextStyle = STYLE.mono;
const MONO_SMALL: TextStyle = { font: "mono", size: 7, color: COLOR.ink };
const MUTED = STYLE.smallMuted;

function part(text: string, style?: TextStyle): CellPart {
  return style ? { text, style } : { text };
}

/** One entry of the cover's summary grid: a small label over its value. */
type Fact = readonly [label: string, value: readonly CellPart[]];
const FACT_LABEL: TextStyle = { font: "bold", size: 7.5, color: COLOR.muted };

type KeyValueRow = readonly [label: string, value: Cell];

/* A heading stays on the page of a short block that follows it; a long block is allowed to break. */
const KEEP_TOGETHER_LIMIT = 400;

function factCell([label, value]: Fact): CellPart[] {
  return [part(label, FACT_LABEL), ...value];
}

/** A hash as two lines of four groups, which fits a narrow table column and still reads as one value. */
function hashParts(hex: string, style: TextStyle = MONO_SMALL): CellPart[] {
  const groups = groupHash(hex).split(" ");
  return [part(groups.slice(0, 4).join(" "), style), part(groups.slice(4).join(" "), style)];
}

function actorText(actor: EvidenceRecordActor | null): string {
  if (actor === null) return "";
  const label = ACTOR_LABEL[actor.type];
  return actor.name ? `${label}: ${actor.name}` : label;
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function scopeLines(value: EvidenceScopeValue, prefix: string): string[] {
  if (Array.isArray(value)) {
    if (value.every((entry) => entry === null || typeof entry !== "object")) return [`${prefix}: ${value.map((entry) => String(entry)).join("; ")}`];
    return value.flatMap((entry, index) => scopeLines(entry, `${prefix} ${index + 1}`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) => scopeLines(entry, `${prefix} / ${humanizeKey(key).toLowerCase()}`));
  }
  return [`${prefix}: ${value === null ? "none" : String(value)}`];
}

function consentRows(consent: EvidenceRecordConsent): Array<readonly [string, Cell]> {
  const scope = Object.entries(consent.scope).flatMap(([key, value]) => scopeLines(value, humanizeKey(key)));
  return [
    ["Consent", [part(consentKindLabel(consent.kind) ?? humanizeKey(consent.kind), STYLE.bodyBold), part(`${consent.kind} / ${consent.id}`, MONO)]],
    ["Text version", consent.copy_version],
    ["Given", `${formatUtcTimestamp(consent.granted_at)} by ${consent.granted_by}`],
    ["Language shown", consent.locale],
    ["SHA-256 of the exact text shown", [part(groupHash(consent.copy_sha256), MONO)]],
    ["Scope", scope.length > 0 ? scope.map((line) => part(line, STYLE.small)) : "No structured scope was recorded."],
  ];
}

/**
 * Renders the evidence pack. Refuses (a `validation_failed` AppError) when the envelope's `record_sha256` is
 * not the hash of the record, so a PDF can never print an integrity page that contradicts its own content.
 * It does not check the signature: that needs a public key and is `verifySignedEvidence`'s job.
 */
export async function renderEvidencePdf(signed: SignedEvidence, options: EvidencePdfOptions): Promise<Uint8Array> {
  const { record, signature } = signed;
  if (record.schema_version !== EVIDENCE_SCHEMA_VERSION) throw invalid("Only evidence records of the current schema version can be rendered");
  if (sha256Hex(canonicalRecordBytes(record)) !== signature.record_sha256) {
    throw invalid("The signed evidence is inconsistent: record_sha256 does not match the record. Sign the record again before rendering it.");
  }
  let verifyUrl: URL;
  try {
    verifyUrl = new URL(options.verifyUrl);
  } catch {
    throw invalid("verifyUrl must be an absolute URL of the public key set");
  }
  if (verifyUrl.protocol !== "https:" && verifyUrl.protocol !== "http:") throw invalid("verifyUrl must be an http(s) URL");
  // The URL is printed. A public key set needs no credentials, so one that carries any is a mistake.
  if (verifyUrl.username !== "" || verifyUrl.password !== "") throw invalid("verifyUrl must not contain a user name or password");
  const brandName = options.brand.name.trim();
  if (brandName === "") throw invalid("brand.name is required");

  const test = record.mode === "test";
  const { decision, household, geography, threshold, income, categorical } = record;
  const pdf = await PdfWriter.create({ watermark: test ? PDF_COPY.testWatermark : null });
  const students = household.students.map((student) => student.name).join(", ");
  const memberLabel = (memberId: string | null): string => {
    if (memberId === null) return "";
    const member = household.members.find((entry) => entry.member_id === memberId);
    return member ? `${member.initials} (${MEMBER_ROLE_LABEL[member.role].toLowerCase()})` : memberId;
  };
  const county = `${geography.county_name}, ${geography.state}`;
  const statusColor = STATUS_COLOR[decision.status];
  const limitRange = threshold.readings_agree ? formatMoney(threshold.upper_bound_cents) : `${formatMoney(threshold.lower_bound_cents)} to ${formatMoney(threshold.upper_bound_cents)}, depending on the reading`;

  /* ------------------------------------------------------------------------------ cover summary */

  pdf.title(DOCUMENT_TITLE);
  pdf.paragraph(PDF_COPY.provenance(record.sgo.name), MUTED, { gapAfter: 10 });
  if (test) {
    pdf.callout([{ text: PDF_COPY.testBanner, style: { font: "bold", size: 9, color: COLOR.red } }], { border: COLOR.red, background: COLOR.redPanel });
  }

  pdf.callout(
    [
      { text: `${STATUS_LABEL[decision.status]}  -  ${STATUS_DETAIL[decision.status]}`, style: { font: "bold", size: 15, color: statusColor } },
      { text: decision.summary, style: STYLE.body },
    ],
    { border: statusColor, background: COLOR.panel, bar: true, title: { text: "DECISION", style: { font: "bold", size: 7.5, color: COLOR.muted } } },
  );

  if (threshold.provisional) {
    // The words in this block are the threshold label's, printed as supplied. Its full explanation is in section 1.
    pdf.callout(
      [
        { text: threshold.label.limit_label, style: STYLE.smallBold },
        { text: threshold.label.source_line, style: STYLE.small },
      ],
      { border: COLOR.amber, background: COLOR.amberPanel, title: { text: threshold.label.badge, style: { font: "bold", size: 10.5, color: COLOR.amber } } },
    );
  }

  // A verification still in review has been routed, not decided.
  const decided = decision.status === "needs_review" ? "Sent to review" : "Decided";
  const decidedBy =
    decision.decided_by.type === "reviewer"
      ? `Reviewer: ${decision.decided_by.reviewer_name ?? ""} (${decision.decided_by.reviewer_id ?? ""})`
      : `Decision engine, version ${record.versions.engine}`;
  const limitFact: CellPart[] = [part(limitRange, STYLE.bodyBold)];
  if (threshold.relied_on === "lower_bound" || threshold.relied_on === "upper_bound") {
    limitFact.push(part(`The decision relied on the ${threshold.relied_on === "lower_bound" ? "lower" : "upper"} bound: ${formatMoney(threshold.relied_on_limit_cents ?? 0)}`, STYLE.small));
  }
  if (threshold.cap_pct !== 300) limitFact.push(part(`Set at ${threshold.cap_pct}% of area median income, the SGO's stricter cap`, STYLE.small));
  if (threshold.relied_on === "statutory_limit") {
    limitFact.push(part(`The decision relied on the limit at the statutory 300%: ${formatMoney(threshold.relied_on_limit_cents ?? 0)}`, STYLE.small));
  }
  // With a provisional table the block above already carries the source line; otherwise it is shown here.
  if (!threshold.provisional) limitFact.push(part(threshold.label.source_line, MUTED));
  limitFact.push(part(`Table ${threshold.table_version}, effective ${formatCalendarDate(threshold.effective_date)}`, MUTED));

  const incomeHasRange = income !== null && (income.lower_bound_cents !== income.total_counted_cents || income.upper_bound_cents !== income.total_counted_cents);
  const incomeFact: Fact | null =
    income === null
      ? null
      : [
          `Household income counted (${income.year})`,
          [
            part(formatMoney(income.total_counted_cents), STYLE.bodyBold),
            ...(incomeHasRange ? [part(`Between ${formatMoney(income.lower_bound_cents)} and ${formatMoney(income.upper_bound_cents)} when lines that can be read more than one way are taken into account`, STYLE.small)] : []),
          ],
        ];
  const categoricalFact: Fact | null =
    categorical === null
      ? null
      : [
          decision.method === "categorical" ? "Categorical basis" : "Categorical documentation on file",
          categorical.program_label !== null
            ? [
                part(categorical.program_label, STYLE.bodyBold),
                part(`${categorical.letter_date ? `Documentation dated ${formatCalendarDate(categorical.letter_date)}. ` : ""}Approval status read from the document: ${APPROVAL_LABEL[categorical.approval_status].toLowerCase()}.`, STYLE.small),
              ]
            : [part("Program not yet determined")],
        ];
  // A decided verification carries one of the two; one still in review may carry both, or neither.
  const basisFacts: Fact[] = [incomeFact, categoricalFact].filter((fact): fact is Fact => fact !== null);
  if (basisFacts.length === 0) basisFacts.push(["Income or categorical basis", [part("Nothing recorded yet")]]);

  const sgoDetail = [record.sgo.ein ? `EIN ${record.sgo.ein}` : "", record.sgo.external_ref ? `SGO reference: ${record.sgo.external_ref}` : ""].filter((text) => text !== "").join("  |  ");
  const facts: Fact[] = [
    ["Verification", [part(record.verification_id, MONO)]],
    ["Scholarship granting organization", [part(record.sgo.name), ...(sgoDetail === "" ? [] : [part(sgoDetail, MUTED)])]],
    [household.students.length === 1 ? "Student" : "Students", [part(students)]],
    ["Household size", [part(`${household.size} ${household.size === 1 ? "person" : "persons"}`)]],
    ["Method", [part(decision.method_label), part(`${METHOD_BASIS_LABEL[decision.method_basis]}.${decision.method_citation ? ` ${decision.method_citation}` : ""}`, MUTED)]],
    ["County and area", [part(`${county} (FIPS ${geography.county_fips})`), part(`${geography.area_name} (area code ${geography.area_code})`, MUTED)]],
    [threshold.label.limit_label, limitFact],
    ...basisFacts,
    ["Income year", [part(`${decision.income_year} (application dated ${formatCalendarDate(decision.application_date)})`)]],
    [decided, [part(formatUtcTimestamp(decision.decided_at)), part(decidedBy, MUTED)]],
    ["Result valid until", [part(decision.expires_at ? formatUtcTimestamp(decision.expires_at) : "No expiry recorded")]],
    ["Mode", [part(test ? "Test (sandbox)" : "Live")]],
    ...(record.reused_from_verification_id ? [["Reuses the result of verification", [part(record.reused_from_verification_id, MONO)]] as Fact] : []),
  ];
  const half = CONTENT_WIDTH / 2;
  const factRows: Cell[][] = [];
  for (let index = 0; index < facts.length; index += 2) {
    factRows.push([factCell(facts[index]), index + 1 < facts.length ? factCell(facts[index + 1]) : ""]);
  }
  pdf.table(
    [
      { header: "", width: half, style: STYLE.body },
      { header: "", width: half, style: STYLE.body },
    ],
    factRows,
    { header: false },
  );

  pdf.callout(
    PDF_COPY.howToRead.map((text) => ({ text, style: STYLE.small })),
    { border: COLOR.rule, background: COLOR.white, title: { text: PDF_COPY.howToReadTitle, style: STYLE.bodyBold } },
  );

  /* -------------------------------------------------------------- 1. how the limit was calculated */

  pdf.heading("1. How this limit was calculated");
  pdf.paragraph(threshold.label.explanation, STYLE.body, { gapAfter: 8 });
  const medianRow: Array<readonly [string, Cell]> = threshold.median_income_cents !== null ? [["Area median income (four-person basis)", formatMoney(threshold.median_income_cents)]] : [];
  const multiplierRow: Array<readonly [string, Cell]> =
    threshold.family_size_multiplier !== null ? [["Family-size multiplier", `${threshold.family_size_multiplier} for a household of ${household.size}`]] : [];
  pdf.keyValues(
    [
      [threshold.label.limit_label, [part(limitRange, STYLE.bodyBold)]],
      ["Formula", threshold.formula],
      ...medianRow,
      ...multiplierRow,
      [
        "Percent of area median",
        threshold.cap_pct === 300
          ? "300% (the statutory limit)"
          : [
              part(`${threshold.cap_pct}% (the SGO's stricter cap)`),
              part(`At the statutory 300% the limit is ${formatMoney(threshold.statutory_limit_cents)}; the largest reading at 300% is ${formatMoney(threshold.statutory_upper_bound_cents)}`, STYLE.small),
            ],
      ],
      ["County and area", `${county} (FIPS ${geography.county_fips}); ${geography.area_name} (area code ${geography.area_code})`],
      ["Source of the table", [part(`${threshold.label.badge} (${threshold.source})`)]],
      ["Table version", [part(threshold.table_version, MONO)]],
      ["Effective date of the table", `${formatCalendarDate(threshold.effective_date)} (${threshold.effective_date})`],
      ...(threshold.method ? [["Calculation method id", [part(threshold.method, MONO)]] as const] : []),
      ["Wording version", [part(threshold.label.copy_version, MONO)]],
    ],
    180,
  );

  const readingColumns: Column[] = [
    { header: "Reading", width: 190 },
    { header: "Arithmetic", width: 224 },
    { header: "Limit", width: 90, align: "right", style: STYLE.smallBold },
  ];
  const readingRows: Cell[][] = threshold.readings.map((reading) => [[part(reading.label), part(reading.id, MONO_SMALL)], reading.formula, formatMoney(reading.limit_cents)]);
  pdf.subheading(threshold.readings.length === 1 ? "The limit under the table in use" : "Every reading of the limit", Math.min(pdf.tableHeight(readingColumns, readingRows), KEEP_TOGETHER_LIMIT));
  pdf.table(readingColumns, readingRows);
  if (!threshold.readings_agree) {
    pdf.keyValues(
      [
        ["Lower bound (smallest reading)", formatMoney(threshold.lower_bound_cents)],
        ["Upper bound (largest reading)", formatMoney(threshold.upper_bound_cents)],
      ],
      180,
    );
  }
  if (threshold.label.readings_note) pdf.paragraph(threshold.label.readings_note, STYLE.small);
  pdf.callout([{ text: threshold.relied_on_statement, style: STYLE.body }], {
    border: COLOR.accent,
    background: COLOR.panel,
    bar: true,
    title: { text: "Which limit the decision relied on", style: STYLE.bodyBold },
  });

  /* -------------------------------------------------------------------------------- 2. household */

  const custody = household.custody;
  const custodyOutcome = custody?.outcome ? [part(`Determination: ${custodyOutcomeLabel(custody.outcome) ?? humanizeKey(custody.outcome)}`, STYLE.small)] : [];
  const custodyCell: Cell =
    custody === null
      ? "No shared-custody information was recorded."
      : !custody.lives_in_multiple_households
        ? [part("The student does not live in more than one household."), ...custodyOutcome]
        : [
            part("The student lives in more than one household."),
            ...(custody.months_in_this_household !== null ? [part(`Months in this household during the income year: ${custody.months_in_this_household}`, STYLE.small)] : []),
            ...(custody.equal_time !== null ? [part(`Equal time in both households: ${yesNo(custody.equal_time).toLowerCase()}`, STYLE.small)] : []),
            ...(custody.this_household_has_higher_income !== null ? [part(`This household has the higher income: ${custody.this_household_has_higher_income}`, STYLE.small)] : []),
            ...custodyOutcome,
            ...(custody.notes ? [part(`Notes: ${custody.notes}`, STYLE.small)] : []),
          ];
  const householdRows: KeyValueRow[] = [
    ["Household size (family size)", `${household.size} ${household.size === 1 ? "person" : "persons"}, counted from the roster below`],
    ...(household.id ? [["Household", [part(household.id, MONO)]] as const] : []),
    [household.students.length === 1 ? "Student" : "Students", household.students.map((student) => part(`${student.name}  (${student.member_id})`))],
    ["Residence", [part(`${county}${geography.zip ? `, ZIP ${geography.zip}` : ""}`), ...(geography.county_resolution ? [part(COUNTY_RESOLUTION_LABEL[geography.county_resolution], MUTED)] : [])]],
    ["Shared custody", custodyCell],
  ];
  pdf.heading("2. Household", Math.min(pdf.keyValuesHeight(householdRows, 180), KEEP_TOGETHER_LIMIT));
  pdf.keyValues(householdRows, 180);
  pdf.table(
    [
      { header: "Member", width: 190, style: MONO },
      { header: "Role", width: 124 },
      { header: "Initials", width: 60 },
      { header: "Relationship to the student", width: 130 },
    ],
    household.members.map((member) => [member.member_id, MEMBER_ROLE_LABEL[member.role], member.initials, member.relationship ?? ""]),
  );
  pdf.paragraph(PDF_COPY.minimization, STYLE.note);

  /* ------------------------------------------------------------------------ 3. evidence reviewed */

  pdf.heading("3. Evidence reviewed");
  pdf.subheading(`Documents (${record.documents.length})`);
  if (record.documents.length === 0) {
    pdf.paragraph(PDF_COPY.noDocuments, STYLE.body);
  } else {
    pdf.table(
      [
        { header: "Document", width: 124 },
        { header: "File, size, uploaded (UTC)", width: 116 },
        { header: "Extraction and raw file", width: 106 },
        { header: "SHA-256 of the stored file", width: 158 },
      ],
      record.documents.map((document) => [
        [part(DOCUMENT_KIND_LABEL[document.kind], STYLE.smallBold), part(document.id, MONO_SMALL), ...(document.member_id ? [part(`About ${memberLabel(document.member_id)}`, MUTED)] : [])],
        [part(document.filename), part(formatBytes(document.size_bytes), MUTED), part(formatUtcClock(document.uploaded_at), MUTED)],
        [part(EXTRACTOR_LABEL[document.extracted_by]), part(document.purged_at ? PDF_COPY.purged(utcDateOf(document.purged_at)) : PDF_COPY.retained, MUTED)],
        hashParts(document.sha256),
      ]),
    );
  }

  pdf.subheading(`Data connections (${record.rails.length})`);
  if (record.rails.length === 0) {
    pdf.paragraph(PDF_COPY.noRails, STYLE.body);
  } else {
    pdf.table(
      [
        { header: "Connection", width: 150 },
        { header: "Connected and retrieved (UTC)", width: 196 },
        { header: "SHA-256 of the report", width: 158 },
      ],
      record.rails.map((rail) => [
        [part(RAIL_KIND_LABEL[rail.kind], STYLE.smallBold), part(rail.id, MONO_SMALL), part(`Provider: ${rail.provider}`, MUTED), ...(rail.member_id ? [part(`About ${memberLabel(rail.member_id)}`, MUTED)] : [])],
        [
          part(`Connected ${formatUtcClock(rail.connected_at)}`),
          ...(rail.retrieved_at ? [part(`Report retrieved ${formatUtcClock(rail.retrieved_at)}`)] : []),
          ...(rail.consent_id ? [part(`Under consent ${rail.consent_id}`, MUTED)] : []),
        ],
        hashParts(rail.report_sha256),
      ]),
    );
  }

  if (record.documents.length > 0) {
    pdf.subheading("Fields read from each document");
    for (const document of record.documents) {
      pdf.ensure(54);
      pdf.paragraph(`${DOCUMENT_KIND_LABEL[document.kind]}  -  ${document.id}  -  ${EXTRACTOR_LABEL[document.extracted_by].toLowerCase()}`, STYLE.smallBold, { gapAfter: 2 });
      if (document.extracted_fields.length === 0) {
        pdf.paragraph(PDF_COPY.noFields, MUTED);
        continue;
      }
      pdf.table(
        [
          { header: "Field", width: 200 },
          { header: "Value", width: 234 },
          { header: "Confidence", width: 70, align: "right" },
        ],
        document.extracted_fields.map((field) => [
          [part(field.label), part(field.key, MONO_SMALL)],
          field.amount_cents !== null ? formatMoney(field.amount_cents) : (field.value ?? ""),
          field.confidence_pct !== null ? `${field.confidence_pct}%` : "",
        ]),
      );
    }
  }

  /* ------------------------------------------------------------- 4. income or categorical detail */

  const categoricalRows: KeyValueRow[] =
    categorical === null
      ? []
      : [
          ["Program", categorical.program_label ?? "Not yet determined"],
          ["Documentation dated", categorical.letter_date ? `${formatCalendarDate(categorical.letter_date)} (${categorical.letter_date})` : "Not yet determined"],
          ["Approval status read from the document", APPROVAL_LABEL[categorical.approval_status]],
          ...(categorical.benefit_period_end ? [["Benefit or certification period ends", `${formatCalendarDate(categorical.benefit_period_end)} (${categorical.benefit_period_end})`] as const] : []),
          ...(categorical.issuing_agency ? [["Issuing agency", categorical.issuing_agency] as const] : []),
          ...(categorical.named_member_id ? [["Household member named", [part(memberLabel(categorical.named_member_id)), part(categorical.named_member_id, MONO)]] as const] : []),
          ...(categorical.document_id ? [["Document", [part(categorical.document_id, MONO)]] as const] : []),
          ["Application date", `${formatCalendarDate(decision.application_date)} (${decision.application_date})`],
          [decided, formatUtcTimestamp(decision.decided_at)],
        ];

  if (income !== null) {
    pdf.heading(`4. Household income for ${income.year}`);
    if (income.items.length === 0) {
      pdf.paragraph(PDF_COPY.noIncomeItems, STYLE.body);
    } else {
      pdf.table(
        [
          { header: "Category", width: 172 },
          { header: "Source", width: 136 },
          { header: "Treatment", width: 116 },
          { header: "Annual amount", width: 80, align: "right" },
        ],
        income.items.map((item) => [
          [part(item.category_label, STYLE.smallBold), ...(item.description ? [part(item.description)] : []), ...(item.member_id ? [part(`Member ${memberLabel(item.member_id)}`, MUTED)] : [])],
          [part(INCOME_SOURCE_LABEL[item.source]), ...(item.document_id ? [part(item.document_id, MONO_SMALL)] : []), ...(item.rail_id ? [part(item.rail_id, MONO_SMALL)] : [])],
          [part(INCOME_TREATMENT_LABEL[item.treatment], item.treatment === "counted" ? STYLE.small : STYLE.smallBold), ...(item.basis ? [part(item.basis, MUTED)] : [])],
          [part(formatMoney(item.annual_amount_cents), item.treatment === "counted" ? STYLE.small : MUTED)],
        ]),
      );
    }
    pdf.table(
      [
        { header: "", width: CONTENT_WIDTH - 130, style: STYLE.bodyBold },
        { header: "", width: 130, align: "right", style: STYLE.bodyBold },
      ],
      [
        [`Total household cash income counted for ${income.year}`, formatMoney(income.total_counted_cents)],
        ...(incomeHasRange
          ? [
              [[part("Least it can be, where a line can be read more than one way", STYLE.small)], [part(formatMoney(income.lower_bound_cents), STYLE.small)]],
              [[part("Most it can be, with the lines whose treatment is open", STYLE.small)], [part(formatMoney(income.upper_bound_cents), STYLE.small)]],
            ]
          : []),
      ],
      { header: false },
    );
    if (categorical !== null) {
      // Only a verification still in review carries both.
      pdf.subheading("Categorical documentation on file", Math.min(pdf.keyValuesHeight(categoricalRows, 190), KEEP_TOGETHER_LIMIT));
      pdf.keyValues(categoricalRows, 190);
    }
  } else if (categorical !== null) {
    pdf.heading("4. Categorical eligibility detail", Math.min(pdf.keyValuesHeight(categoricalRows, 190), KEEP_TOGETHER_LIMIT));
    pdf.keyValues(categoricalRows, 190);
    if (record.data_minimization.income_detail_omitted) pdf.paragraph(PDF_COPY.incomeOmitted, STYLE.note);
  } else {
    pdf.heading("4. Income or categorical detail");
    pdf.paragraph(PDF_COPY.noBasis, STYLE.body);
  }

  /* ---------------------------------------------------------------------------------- 5. consent */

  const primaryConsent = consentRows(record.consent);
  pdf.heading("5. Consent record", Math.min(pdf.keyValuesHeight(primaryConsent, 150), KEEP_TOGETHER_LIMIT));
  pdf.keyValues(primaryConsent, 150);
  for (const consent of record.additional_consents) {
    const rows = consentRows(consent);
    pdf.gap(4);
    pdf.ensure(Math.min(pdf.keyValuesHeight(rows, 150), KEEP_TOGETHER_LIMIT));
    pdf.keyValues(rows, 150);
  }

  /* ----------------------------------------------------------------------------- 6. review trail */

  const decisionRows: KeyValueRow[] = [
    [`${decided} by`, decidedBy],
    [decided, formatUtcTimestamp(decision.decided_at)],
    ...(decision.decided_by.reviewer_notes ? [["Reviewer notes", decision.decided_by.reviewer_notes] as const] : []),
  ];
  pdf.heading("6. Decision reasons and review trail", Math.min(pdf.keyValuesHeight(decisionRows, 150), KEEP_TOGETHER_LIMIT));
  pdf.keyValues(decisionRows, 150);
  if (decision.reasons.length > 0) {
    pdf.table(
      [
        { header: "Reason code", width: 150, style: MONO },
        { header: "Reason", width: CONTENT_WIDTH - 150 },
      ],
      decision.reasons.map((reason) => {
        const about = [...reason.member_ids.map((memberId) => memberLabel(memberId)), ...reason.source_ids];
        return [reason.code, [part(reason.message), ...(about.length > 0 ? [part(`About: ${about.join(", ")}`, MUTED)] : [])]];
      }),
    );
  }
  if (record.review_trail.length === 0) {
    pdf.paragraph(decision.decided_by.type === "engine" ? PDF_COPY.noReviewEngine(record.versions.engine) : PDF_COPY.noReviewEntries, STYLE.body);
  } else {
    pdf.subheading("Who or what reviewed exceptions");
    pdf.table(
      [
        { header: "When (UTC)", width: 100 },
        { header: "Who or what", width: 134 },
        { header: "Action", width: 110 },
        { header: "Notes", width: 160 },
      ],
      record.review_trail.map((entry) => [
        formatUtcClock(entry.at),
        [part(actorText(entry.actor)), ...(entry.actor.id ? [part(entry.actor.id, MONO_SMALL)] : [])],
        entry.action,
        entry.notes ?? "",
      ]),
    );
  }

  /* --------------------------------------------------------------------------------- 7. timeline */

  pdf.heading("7. Timeline");
  if (record.timeline.length === 0) {
    pdf.paragraph(PDF_COPY.noTimeline, STYLE.body);
  } else {
    pdf.table(
      [
        { header: "When (UTC)", width: 100 },
        { header: "Event", width: 144 },
        { header: "Who or what", width: 110 },
        { header: "Detail", width: 150 },
      ],
      record.timeline.map((entry) => [formatUtcClock(entry.at), entry.event, actorText(entry.actor), entry.detail ?? ""]),
    );
  }

  /* -------------------------------------------------------------------------------- 8. integrity */

  pdf.pageBreak();
  pdf.heading("8. Integrity and verification");
  pdf.paragraph(PDF_COPY.governs, STYLE.body, { gapAfter: 8 });
  pdf.keyValues(
    [
      ["Record SHA-256", [part(groupHash(signature.record_sha256), MONO)]],
      ["Signature algorithm", `${signature.alg} (Ed25519)`],
      ["Signing key id", [part(signature.kid, MONO)]],
      ["Signature (base64url)", [part(signature.value, MONO)]],
      ["Canonicalization", `${signature.canonicalization}: RFC 8785 JSON canonicalization (keys sorted, no white space, UTF-8), with whole numbers, text, true, false and null as the only values`],
      ["Public keys", [part(verifyUrl.href, MONO)]],
      ["Record generated", formatUtcTimestamp(record.generated_at)],
      ["Schema version", record.schema_version],
      ["Engine version", [part(record.versions.engine, MONO)]],
      ["Income taxonomy version", [part(record.versions.taxonomy, MONO)]],
      ...(record.versions.rule_set ? [["Rule set", [part(record.versions.rule_set, MONO)]] as const] : []),
      ["Wording version", [part(record.copy_version, MONO)]],
      ["Data-minimization rule", [part(record.data_minimization.rule_version, MONO)]],
    ],
    150,
  );
  pdf.subheading("How to verify the signed record");
  pdf.list(
    [
      `Get the signed JSON record for verification ${record.verification_id} from the scholarship granting organization. It has two parts: "record" and "signature".`,
      `Get the public keys from ${verifyUrl.href} and pick the key whose "kid" is ${signature.kid}. A copy of that file saved earlier works offline.`,
      'Canonicalize the "record" part, compute its SHA-256 and compare it with the record SHA-256 printed above.',
      "Check the Ed25519 signature over the same canonical bytes with that public key.",
    ],
    (index) => `${index + 1}.`,
  );
  pdf.paragraph("The command-line check does all four steps and prints PASS or FAIL:", STYLE.body, { gapAfter: 3 });
  pdf.callout([{ text: "npm run evidence:verify -- <record.json> --jwks <key-set file or URL>", style: MONO }], { border: COLOR.rule, background: COLOR.panel });
  pdf.paragraph(PDF_COPY.minimization, STYLE.note);
  if (record.data_minimization.ssn_patterns_removed > 0 || record.data_minimization.extracted_fields_removed > 0) {
    pdf.paragraph(
      `While this record was built, ${record.data_minimization.ssn_patterns_removed} number-shaped ${record.data_minimization.ssn_patterns_removed === 1 ? "token" : "tokens"} resembling a Social Security number and ${record.data_minimization.extracted_fields_removed} extracted ${record.data_minimization.extracted_fields_removed === 1 ? "field" : "fields"} naming a birth date or an identity or account number were removed.`,
      STYLE.note,
    );
  }
  // Encode the fixed strings below before reading the counter, so the note reports the final figure.
  const headerFooter = {
    headerLeft: `${brandName}  |  ${DOCUMENT_TITLE}`,
    headerRight: record.verification_id,
    footerLeft: `${test ? `${PDF_COPY.testWatermark}  |  ` : ""}Generated ${formatUtcTimestamp(record.generated_at)}  |  Record SHA-256 ${signature.record_sha256.slice(0, 16)}...`,
  };
  for (const value of Object.values(headerFooter)) pdf.encoder.encode(value);
  const substituted = pdf.encoder.substituted;
  if (substituted > 0) pdf.paragraph(PDF_COPY.transliteration(substituted), STYLE.note);
  pdf.finish(headerFooter);

  /* ----------------------------------------------------------------------------------- metadata */

  const generatedAt = new Date(record.generated_at);
  const doc = pdf.doc;
  doc.setTitle(`${DOCUMENT_TITLE} ${record.verification_id}`, { showInWindowTitleBar: true });
  doc.setSubject(`Household income verification for ${record.sgo.name}: ${STATUS_LABEL[decision.status].toLowerCase()}${decision.method ? `, ${decision.method} method` : ""}${test ? " (test mode)" : ""}`);
  doc.setAuthor(brandName);
  doc.setCreator(`${brandName} evidence engine ${record.versions.engine}`);
  doc.setProducer(`${EVIDENCE_PDF_RENDERER} (pdf-lib)`);
  doc.setKeywords([record.verification_id, `record-sha256:${signature.record_sha256}`, `kid:${signature.kid}`, `schema:${record.schema_version}`, `mode:${record.mode}`]);
  doc.setLanguage("en-US");
  doc.setCreationDate(generatedAt);
  doc.setModificationDate(generatedAt);
  return doc.save();
}
