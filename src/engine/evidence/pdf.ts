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
  MEMBER_ROLE_LABEL,
  METHOD_BASIS_LABEL,
  PDF_COPY,
  RAIL_KIND_LABEL,
  STATUS_DETAIL,
  STATUS_LABEL,
  consentKindLabel,
} from "./copy";
import { formatBytes, formatCalendarDate, formatMoney, formatUtcTimestamp, groupHash, humanizeKey, utcDateOf } from "./format";
import { COLOR, CONTENT_WIDTH, PdfWriter, STYLE, type Cell, type CellPart, type TextStyle } from "./pdf-layout";
import { canonicalRecordBytes } from "./record";
import {
  EVIDENCE_SCHEMA_VERSION,
  type EvidencePdfOptions,
  type EvidenceRecord,
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

  const decidedBy =
    decision.decided_by.type === "reviewer"
      ? `Reviewer: ${decision.decided_by.reviewer_name ?? ""} (${decision.decided_by.reviewer_id ?? ""})`
      : `Decision engine, version ${record.versions.engine}`;
  const limitCell: CellPart[] = [part(limitRange, STYLE.bodyBold)];
  if (threshold.relied_on === "lower_bound" || threshold.relied_on === "upper_bound") {
    limitCell.push(part(`The decision relied on the ${threshold.relied_on === "lower_bound" ? "lower" : "upper"} bound: ${formatMoney(threshold.relied_on_limit_cents ?? 0)}`, STYLE.small));
  }
  if (threshold.cap_pct !== 300) limitCell.push(part(`Set at ${threshold.cap_pct}% of area median income, the SGO's stricter cap`, STYLE.small));
  limitCell.push(part(threshold.label.source_line, MUTED));

  const basisRow: readonly [string, Cell] =
    income !== null
      ? [`Household income counted (${income.year})`, [part(formatMoney(income.total_counted_cents), STYLE.bodyBold)]]
      : [
          "Categorical basis",
          categorical !== null && categorical.program_label !== null
            ? [
                part(categorical.program_label, STYLE.bodyBold),
                part(`${categorical.letter_date ? `Documentation dated ${formatCalendarDate(categorical.letter_date)}. ` : ""}Approval status read from the document: ${APPROVAL_LABEL[categorical.approval_status].toLowerCase()}.`, STYLE.small),
              ]
            : "Program not yet determined",
        ];

  const summaryRows: Array<readonly [string, Cell]> = [
    ["Verification", [part(record.verification_id, MONO)]],
    ["Scholarship granting organization", [part(record.sgo.name), ...(record.sgo.ein ? [part(`EIN ${record.sgo.ein}`, MUTED)] : []), ...(record.sgo.external_ref ? [part(`SGO reference: ${record.sgo.external_ref}`, MUTED)] : [])]],
    [household.students.length === 1 ? "Student" : "Students", students],
    ["Status", [part(`${STATUS_LABEL[decision.status]} (${STATUS_DETAIL[decision.status].toLowerCase()})`, { ...STYLE.bodyBold, color: statusColor })]],
    ["Method", [part(decision.method_label), part(`${METHOD_BASIS_LABEL[decision.method_basis]}. ${decision.method_citation}`, MUTED)]],
    ["Household size", `${household.size} ${household.size === 1 ? "person" : "persons"}`],
    ["County and area", [part(`${county} (FIPS ${geography.county_fips})`), part(`${geography.area_name} (area code ${geography.area_code})`, MUTED)]],
    ["Income year", `${decision.income_year} (application dated ${formatCalendarDate(decision.application_date)})`],
    [threshold.label.limit_label, limitCell],
    basisRow,
    ["Decided", [part(formatUtcTimestamp(decision.decided_at)), part(decidedBy, MUTED)]],
    ...(decision.expires_at ? [["Result valid until", formatUtcTimestamp(decision.expires_at)] as const] : []),
    ...(record.reused_from_verification_id ? [["Reuses the result of", [part(record.reused_from_verification_id, MONO)]] as const] : []),
    ["Mode", test ? "Test (sandbox)" : "Live"],
  ];
  pdf.keyValues(summaryRows, 168);

  if (threshold.provisional) {
    // The words in this block are the threshold label's, printed as supplied.
    pdf.callout(
      [
        { text: threshold.label.limit_label, style: STYLE.smallBold },
        { text: threshold.label.source_line, style: STYLE.small },
        { text: threshold.label.explanation, style: STYLE.small },
      ],
      { border: COLOR.amber, background: COLOR.amberPanel, title: { text: threshold.label.badge, style: { font: "bold", size: 10.5, color: COLOR.amber } } },
    );
  }

  pdf.callout(
    PDF_COPY.howToRead.map((text) => ({ text, style: STYLE.small })),
    { border: COLOR.rule, background: COLOR.white, title: { text: PDF_COPY.howToReadTitle, style: STYLE.bodyBold } },
  );

  /* -------------------------------------------------------------- 1. how the limit was calculated */

  pdf.heading("1. How this limit was calculated");
  pdf.paragraph(threshold.label.source_line, STYLE.body);
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
          : `${threshold.cap_pct}% (the SGO's stricter cap; the limit at the statutory 300% is ${formatMoney(threshold.statutory_limit_cents)})`,
      ],
      ["County and area", `${county} (FIPS ${geography.county_fips}); ${geography.area_name} (area code ${geography.area_code})`],
      ["Source of the table", [part(`${threshold.label.badge} (${threshold.source})`)]],
      ["Table version", [part(threshold.table_version, MONO)]],
      ["Effective date of the table", `${formatCalendarDate(threshold.effective_date)} (${threshold.effective_date})`],
      ...(threshold.method ? [["Calculation method id", [part(threshold.method, MONO)]] as const] : []),
      ["Wording version", [part(threshold.label.copy_version, MONO)]],
    ],
    168,
  );

  pdf.subheading(threshold.readings.length === 1 ? "The limit under the table in use" : "Every reading of the limit");
  pdf.table(
    [
      { header: "Reading", width: 190 },
      { header: "Arithmetic", width: 224 },
      { header: "Limit", width: 90, align: "right", style: STYLE.smallBold },
    ],
    threshold.readings.map((reading) => [
      [part(reading.label), part(reading.id, MONO_SMALL)],
      reading.formula,
      formatMoney(reading.limit_cents),
    ]),
  );
  if (!threshold.readings_agree) {
    pdf.keyValues(
      [
        ["Lower bound (smallest reading)", formatMoney(threshold.lower_bound_cents)],
        ["Upper bound (largest reading)", formatMoney(threshold.upper_bound_cents)],
      ],
      168,
    );
  }
  if (threshold.label.readings_note) pdf.paragraph(threshold.label.readings_note, STYLE.small);
  pdf.callout([{ text: threshold.relied_on_statement, style: STYLE.body }], {
    border: COLOR.accent,
    background: COLOR.panel,
    bar: true,
    title: { text: "Which limit the decision relied on", style: STYLE.bodyBold },
  });
  if (!threshold.provisional) pdf.paragraph(threshold.label.explanation, STYLE.small);

  /* -------------------------------------------------------------------------------- 2. household */

  pdf.heading("2. Household");
  const custody = household.custody;
  const custodyCell: Cell =
    custody === null
      ? "No shared-custody information was recorded."
      : !custody.lives_in_multiple_households
        ? "The student does not live in more than one household."
        : [
            part("The student lives in more than one household."),
            ...(custody.months_in_this_household !== null ? [part(`Months in this household during the income year: ${custody.months_in_this_household}`, STYLE.small)] : []),
            ...(custody.equal_time !== null ? [part(`Equal time in both households: ${yesNo(custody.equal_time).toLowerCase()}`, STYLE.small)] : []),
            ...(custody.this_household_has_higher_income !== null ? [part(`This household has the higher income: ${custody.this_household_has_higher_income}`, STYLE.small)] : []),
            ...(custody.notes ? [part(`Notes: ${custody.notes}`, STYLE.small)] : []),
          ];
  pdf.keyValues(
    [
      ["Household size (family size)", `${household.size} ${household.size === 1 ? "person" : "persons"}, counted from the roster below`],
      ...(household.id ? [["Household", [part(household.id, MONO)]] as const] : []),
      [household.students.length === 1 ? "Student" : "Students", household.students.map((student) => part(`${student.name}  (${student.member_id})`))],
      ["Residence", [part(`${county}${geography.zip ? `, ZIP ${geography.zip}` : ""}`), ...(geography.county_resolution ? [part(COUNTY_RESOLUTION_LABEL[geography.county_resolution], MUTED)] : [])]],
      ["Shared custody", custodyCell],
    ],
    168,
  );
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
        { header: "Document", width: 122 },
        { header: "File", width: 122 },
        { header: "Extraction and raw file", width: 110 },
        { header: "SHA-256 of the stored file", width: 150 },
      ],
      record.documents.map((document) => [
        [part(DOCUMENT_KIND_LABEL[document.kind], STYLE.smallBold), part(document.id, MONO_SMALL), ...(document.member_id ? [part(`About ${memberLabel(document.member_id)}`, MUTED)] : [])],
        [part(document.filename), part(formatBytes(document.size_bytes), MUTED), part(`Uploaded ${formatUtcTimestamp(document.uploaded_at)}`, MUTED)],
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
        { header: "Connected and retrieved", width: 204 },
        { header: "SHA-256 of the report", width: 150 },
      ],
      record.rails.map((rail) => [
        [part(RAIL_KIND_LABEL[rail.kind], STYLE.smallBold), part(rail.id, MONO_SMALL), part(`Provider: ${rail.provider}`, MUTED), ...(rail.member_id ? [part(`About ${memberLabel(rail.member_id)}`, MUTED)] : [])],
        [
          part(`Connected ${formatUtcTimestamp(rail.connected_at)}`),
          ...(rail.retrieved_at ? [part(`Report retrieved ${formatUtcTimestamp(rail.retrieved_at)}`)] : []),
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

  if (income !== null) {
    pdf.heading(`4. Household income for ${income.year}`);
    if (income.items.length === 0) {
      pdf.paragraph(PDF_COPY.noIncomeItems, STYLE.body);
    } else {
      pdf.table(
        [
          { header: "Category", width: 160 },
          { header: "Source", width: 150 },
          { header: "Counted", width: 110 },
          { header: "Annual amount", width: 84, align: "right" },
        ],
        income.items.map((item) => [
          [part(item.category_label, STYLE.smallBold), ...(item.description ? [part(item.description)] : []), ...(item.member_id ? [part(`Member ${memberLabel(item.member_id)}`, MUTED)] : [])],
          [part(INCOME_SOURCE_LABEL[item.source]), ...(item.document_id ? [part(item.document_id, MONO_SMALL)] : []), ...(item.rail_id ? [part(item.rail_id, MONO_SMALL)] : [])],
          [part(item.counted ? "Counted" : "Not counted", item.counted ? STYLE.small : STYLE.smallBold), ...(item.basis ? [part(item.basis, MUTED)] : [])],
          [part(formatMoney(item.annual_amount_cents), item.counted ? STYLE.small : MUTED)],
        ]),
      );
    }
    pdf.table(
      [
        { header: "", width: CONTENT_WIDTH - 130, style: STYLE.bodyBold },
        { header: "", width: 130, align: "right", style: STYLE.bodyBold },
      ],
      [[`Total household cash income counted for ${income.year}`, formatMoney(income.total_counted_cents)]],
      { header: false },
    );
  } else if (categorical !== null) {
    pdf.heading("4. Categorical eligibility detail");
    pdf.keyValues(
      [
        ["Program", categorical.program_label ?? "Not yet determined"],
        ["Documentation dated", categorical.letter_date ? `${formatCalendarDate(categorical.letter_date)} (${categorical.letter_date})` : "Not yet determined"],
        ["Approval status read from the document", APPROVAL_LABEL[categorical.approval_status]],
        ...(categorical.benefit_period_end ? [["Benefit or certification period ends", `${formatCalendarDate(categorical.benefit_period_end)} (${categorical.benefit_period_end})`] as const] : []),
        ...(categorical.issuing_agency ? [["Issuing agency", categorical.issuing_agency] as const] : []),
        ...(categorical.named_member_id ? [["Household member named", [part(memberLabel(categorical.named_member_id)), part(categorical.named_member_id, MONO)]] as const] : []),
        ...(categorical.document_id ? [["Document", [part(categorical.document_id, MONO)]] as const] : []),
        ["Application date", `${formatCalendarDate(decision.application_date)} (${decision.application_date})`],
        ["Decision date", formatUtcTimestamp(decision.decided_at)],
      ],
      190,
    );
  }

  /* ---------------------------------------------------------------------------------- 5. consent */

  pdf.heading("5. Consent record");
  pdf.keyValues(consentRows(record.consent), 168);
  for (const consent of record.additional_consents) {
    pdf.gap(4);
    pdf.keyValues(consentRows(consent), 168);
  }

  /* ----------------------------------------------------------------------------- 6. review trail */

  pdf.heading("6. Decision reasons and review trail");
  pdf.keyValues(
    [
      ["Decision made by", decidedBy],
      ["Decision made", formatUtcTimestamp(decision.decided_at)],
      ...(decision.decided_by.reviewer_notes ? [["Reviewer notes", decision.decided_by.reviewer_notes] as const] : []),
    ],
    168,
  );
  if (decision.reasons.length > 0) {
    pdf.table(
      [
        { header: "Reason code", width: 168, style: MONO },
        { header: "Reason", width: CONTENT_WIDTH - 168 },
      ],
      decision.reasons.map((reason) => [reason.code, reason.message]),
    );
  }
  if (record.review_trail.length === 0) {
    pdf.paragraph(decision.decided_by.type === "engine" ? PDF_COPY.noReviewEngine(record.versions.engine) : PDF_COPY.noReviewEntries, STYLE.body);
  } else {
    pdf.subheading("Who or what reviewed exceptions");
    pdf.table(
      [
        { header: "When (UTC)", width: 104 },
        { header: "Who or what", width: 130 },
        { header: "Action", width: 110 },
        { header: "Notes", width: 160 },
      ],
      record.review_trail.map((entry) => [
        formatUtcTimestamp(entry.at),
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
        { header: "When (UTC)", width: 104 },
        { header: "Event", width: 150 },
        { header: "Who or what", width: 110 },
        { header: "Detail", width: 140 },
      ],
      record.timeline.map((entry) => [formatUtcTimestamp(entry.at), entry.event, actorText(entry.actor), entry.detail ?? ""]),
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
    footerLeft: `${test ? `${PDF_COPY.testWatermark}  |  ` : ""}Generated ${formatUtcTimestamp(record.generated_at)}`,
    footerCenter: `Record SHA-256 ${signature.record_sha256.slice(0, 16)}...`,
  };
  for (const value of Object.values(headerFooter)) pdf.encoder.encode(value);
  const substituted = pdf.encoder.substituted;
  if (substituted > 0) pdf.paragraph(PDF_COPY.transliteration(substituted), STYLE.note);
  pdf.finish(headerFooter);

  /* ----------------------------------------------------------------------------------- metadata */

  const generatedAt = new Date(record.generated_at);
  const doc = pdf.doc;
  doc.setTitle(`${DOCUMENT_TITLE} ${record.verification_id}`, { showInWindowTitleBar: true });
  doc.setSubject(`Household income verification for ${record.sgo.name}: ${STATUS_LABEL[decision.status].toLowerCase()}, ${decision.method} method${test ? " (test mode)" : ""}`);
  doc.setAuthor(brandName);
  doc.setCreator(`${brandName} evidence engine ${record.versions.engine}`);
  doc.setProducer(`${EVIDENCE_PDF_RENDERER} (pdf-lib)`);
  doc.setKeywords([record.verification_id, `record-sha256:${signature.record_sha256}`, `kid:${signature.kid}`, `schema:${record.schema_version}`, `mode:${record.mode}`]);
  doc.setLanguage("en-US");
  doc.setCreationDate(generatedAt);
  doc.setModificationDate(generatedAt);
  return doc.save();
}
