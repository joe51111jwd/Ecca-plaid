import { z } from "zod";
import type { MemberRole } from "@/db/schema";
import { invalid } from "@/lib/errors";
import { INCOME_MEASURES, KEYABLE_KINDS, type KeyableKind, type ReviewerExtractionInput } from "@/server/verifications";
import { parseForm, readAll, readFlag, readInt, readLines, readMoney, readOptional, readText } from "./form-data";
import { measureFullLabel } from "./field-labels";

/**
 * FormData → service input for every dashboard form. Pure (no database): structure, types and the dashboard's own
 * limits are checked here; the business rules stay in the services, which validate again.
 */

const id = (label: string) => z.string({ error: `${label} is missing.` }).min(1, `${label} is missing.`).max(128, `${label} is not valid.`);

/* ------------------------------------------------------------------------------------- verifications */

export const AMOUNT_ROWS = 8;

const newVerificationSchema = z.strictObject({
  applicantName: z.string().max(200).nullable(),
  applicantEmail: z.email("Enter a valid email address.").max(320).nullable(),
  studentFirstName: z.string().max(100).nullable(),
  studentLastName: z.string().max(100).nullable(),
  externalRef: z.string().max(200).nullable(),
  sendInvite: z.boolean(),
  locale: z.enum(["en", "es"], { error: "Choose English or Spanish." }),
});

export type NewVerificationForm = z.output<typeof newVerificationSchema>;

export function newVerificationFromForm(formData: FormData): NewVerificationForm {
  const data = parseForm(
    newVerificationSchema,
    {
      applicantName: readOptional(formData, "applicantName"),
      applicantEmail: readOptional(formData, "applicantEmail")?.toLowerCase() ?? null,
      studentFirstName: readOptional(formData, "studentFirstName"),
      studentLastName: readOptional(formData, "studentLastName"),
      externalRef: readOptional(formData, "externalRef"),
      sendInvite: readFlag(formData, "sendInvite"),
      locale: readText(formData, "locale") || "en",
    },
    "Check the applicant details.",
  );
  if (data.sendInvite && !data.applicantEmail) throw invalid("Add the family's email address to send the link.", { fields: { applicantEmail: "Required to email the link." } });
  return data;
}

export function verificationIdFromForm(formData: FormData): string {
  return parseForm(id("The verification"), readText(formData, "verificationId"));
}

export interface ResolveForm {
  verificationId: string;
  resolution: "eligible" | "ineligible";
  notes: string;
  basis: { method: "direct" } | { method: "categorical"; documentId: string };
}

const resolveSchema = z.strictObject({
  verificationId: id("The verification"),
  resolution: z.enum(["eligible", "ineligible"], { error: "Choose eligible or not eligible." }),
  notes: z.string().min(1, "Write what you checked. Notes are required and go into the evidence pack.").max(4000, "Keep the notes under 4,000 characters."),
  method: z.enum(["direct", "categorical"], { error: "Choose the method you relied on." }),
  documentId: z.string().max(128).nullable(),
});

export function resolveFromForm(formData: FormData): ResolveForm {
  const data = parseForm(
    resolveSchema,
    {
      verificationId: readText(formData, "verificationId"),
      resolution: readText(formData, "resolution"),
      notes: readText(formData, "notes"),
      method: readText(formData, "method"),
      documentId: readOptional(formData, "documentId"),
    },
    "Check the resolution.",
  );
  if (data.method === "categorical") {
    if (!data.documentId) throw invalid("Choose the award letter the decision rests on.", { fields: { documentId: "Choose the award letter." } });
    return { verificationId: data.verificationId, resolution: data.resolution, notes: data.notes, basis: { method: "categorical", documentId: data.documentId } };
  }
  return { verificationId: data.verificationId, resolution: data.resolution, notes: data.notes, basis: { method: "direct" } };
}

export function requestInfoFromForm(formData: FormData): { verificationId: string; message: string; items: string[] } {
  const verificationId = verificationIdFromForm(formData);
  const message = readText(formData, "message");
  const items = readLines(formData, "items");
  if (message === "") throw invalid("Write a short message to the family.", { fields: { message: "Required." } });
  if (items.length === 0) throw invalid("List at least one thing to send, one per line.", { fields: { items: "List at least one thing." } });
  return { verificationId, message, items };
}

export interface IncomeLineForm {
  verificationId: string;
  memberId: string | null;
  category: string;
  annualAmountCents: number;
  incomeYear: number | null;
  description: string;
  basis: string;
  documentId: string | null;
}

export function incomeLineFromForm(formData: FormData): IncomeLineForm {
  const verificationId = verificationIdFromForm(formData);
  const category = readText(formData, "category");
  if (!category) throw invalid("Choose the kind of income.", { fields: { category: "Choose a category." } });
  const description = readText(formData, "description");
  const basis = readText(formData, "basis");
  if (!description) throw invalid("Describe the income line.", { fields: { description: "Required." } });
  if (!basis) throw invalid("Say where the figure comes from.", { fields: { basis: "Required." } });
  return {
    verificationId,
    memberId: readOptional(formData, "memberId"),
    category,
    annualAmountCents: readMoney(formData, "annualAmount", { allowNegative: true, label: "the yearly amount" }),
    incomeYear: readInt(formData, "incomeYear", "the income year"),
    description,
    basis,
    documentId: readOptional(formData, "documentId"),
  };
}

/** "w2_box1_wages" → "W-2: Wages (box 1)": the reader's measure keys made readable for a select. */
export function measureLabel(measure: string): string {
  return measureFullLabel(measure);
}

/** Measures a reviewer may key for each kind (the reader's families of measures; the service checks again). */
export function measuresFor(kind: Exclude<KeyableKind, "award_letter">): string[] {
  const prefixes: Record<Exclude<KeyableKind, "award_letter">, string[]> = { w2: ["w2_"], pay_stub: ["paystub_"], tax_return: ["f1040_"], irs_transcript: ["transcript_", "wai_"] };
  return INCOME_MEASURES.filter((m) => prefixes[kind].some((p) => m.startsWith(p)));
}

function isKeyableKind(value: string): value is KeyableKind {
  return (KEYABLE_KINDS as readonly string[]).includes(value);
}

/**
 * The reviewer's keyed fields for one document. Award letters take the program, date, approval and recipient;
 * income documents take up to AMOUNT_ROWS figures. Blank amount rows are skipped.
 */
export function keyedFieldsFromForm(formData: FormData): { documentId: string; input: ReviewerExtractionInput } {
  const documentId = parseForm(id("The document"), readText(formData, "documentId"));
  const kind = readText(formData, "kind");
  if (!isKeyableKind(kind)) throw invalid("Choose what kind of document this is.", { fields: { kind: "Choose a document kind." } });
  const memberId = readOptional(formData, "memberId");
  const notes = readOptional(formData, "notes");
  if (kind === "award_letter") {
    const program = readText(formData, "program");
    return {
      documentId,
      input: {
        kind,
        memberId,
        notes,
        award: {
          program: program === "" ? null : (program as "SNAP" | "TANF" | "WIC" | "SECTION_8" | "SSI"),
          letterDate: readOptional(formData, "letterDate"),
          approvalStatus: (readText(formData, "approvalStatus") || "unclear") as "approved" | "denied" | "terminated" | "pending" | "unclear",
          recipientName: readOptional(formData, "recipientName"),
          householdMembers: readLines(formData, "householdMembers"),
          benefitPeriod: readOptional(formData, "benefitStart") || readOptional(formData, "benefitEnd") ? { start: readOptional(formData, "benefitStart"), end: readOptional(formData, "benefitEnd") } : null,
          issuingAgency: readOptional(formData, "issuingAgency"),
        },
      },
    };
  }
  const amounts: Array<{ measure: (typeof INCOME_MEASURES)[number]; amountCents: number; person: string | null; payer: string | null; statement: number }> = [];
  for (let i = 0; i < AMOUNT_ROWS; i++) {
    const measure = readText(formData, `measure_${i}`);
    const amountRaw = readText(formData, `amount_${i}`);
    if (measure === "" && amountRaw === "") continue;
    if (measure === "") throw invalid("Choose which figure each amount is.", { fields: { [`measure_${i}`]: "Choose the figure." } });
    if (!(INCOME_MEASURES as readonly string[]).includes(measure)) throw invalid("Choose a figure from the list.", { fields: { [`measure_${i}`]: "Unknown figure." } });
    amounts.push({
      measure: measure as (typeof INCOME_MEASURES)[number],
      amountCents: readMoney(formData, `amount_${i}`, { allowNegative: true, label: "the amount" }),
      person: readOptional(formData, `person_${i}`),
      payer: readOptional(formData, `payer_${i}`),
      statement: readInt(formData, `statement_${i}`, "the statement number") ?? 1,
    });
  }
  if (amounts.length === 0) throw invalid("Key at least one amount.", { fields: { measure_0: "Key at least one amount." } });
  return {
    documentId,
    input: {
      kind,
      memberId,
      notes,
      income: {
        taxYear: readInt(formData, "taxYear", "the tax year"),
        payDate: readOptional(formData, "payDate"),
        amounts,
        selfEmploymentIndicated: readFlag(formData, "selfEmploymentIndicated"),
      },
    },
  };
}

export function offerAwardFromForm(formData: FormData) {
  const verificationId = verificationIdFromForm(formData);
  const paymentMethod = readText(formData, "paymentMethod");
  if (!paymentMethod) throw invalid("Choose how the award will be paid.", { fields: { paymentMethod: "Choose a payment method." } });
  if (!readFlag(formData, "remindersRead")) throw invalid("Confirm that you have read the reminders before offering the award.", { fields: { remindersRead: "Required." } });
  return {
    verificationId,
    amountCents: readMoney(formData, "amount", { label: "the award amount" }),
    paymentMethod,
    studentMemberId: readOptional(formData, "studentMemberId"),
    notes: readOptional(formData, "notes"),
  };
}

/* ------------------------------------------------------------------------------------ acknowledgments */

const taxYearSchema = z.number({ error: "Choose a tax year." }).int().min(2000).max(2200);

export function taxYearFromForm(formData: FormData): number {
  return parseForm(taxYearSchema, readInt(formData, "taxYear", "the tax year"), "Choose a tax year.");
}

export function donorScopeFromForm(formData: FormData): { donorId: string; taxYear: number } {
  return { donorId: parseForm(id("The donor"), readText(formData, "donorId")), taxYear: taxYearFromForm(formData) };
}

/* ------------------------------------------------------------------------------------------ settings */

export function profileFromForm(formData: FormData) {
  const displayName = readText(formData, "displayName");
  if (!displayName) throw invalid("Enter the organization's name.", { fields: { displayName: "Required." } });
  return {
    displayName,
    legalName: readOptional(formData, "legalName"),
    ein: readOptional(formData, "ein"),
    description: readOptional(formData, "description"),
    website: readOptional(formData, "website"),
    city: readOptional(formData, "city"),
    state: (readText(formData, "state") || "TX").toUpperCase(),
    supportEmail: readOptional(formData, "supportEmail"),
    acceptsDonations: readFlag(formData, "acceptsDonations"),
    acceptsHandoffs: readFlag(formData, "acceptsHandoffs"),
  };
}

export function policyFromForm(formData: FormData): { incomeCapPct: number; reviewBandBps: number; rawRetentionDays: number } {
  const read = (name: string, label: string) => {
    const v = readInt(formData, name, label);
    if (v === null) throw invalid(`Enter ${label}.`, { fields: { [name]: "Required." } });
    return v;
  };
  return { incomeCapPct: read("incomeCapPct", "the income cap"), reviewBandBps: read("reviewBandBps", "the review band"), rawRetentionDays: read("rawRetentionDays", "the retention period") };
}

const ROLES: readonly MemberRole[] = ["owner", "admin", "reviewer", "viewer"];

export function roleFromForm(formData: FormData): MemberRole {
  const role = readText(formData, "role");
  if (!(ROLES as readonly string[]).includes(role)) throw invalid("Choose a role.", { fields: { role: "Choose a role." } });
  return role as MemberRole;
}

/* ------------------------------------------------------------------------------------------ webhooks */

export function webhookFromForm(formData: FormData): { url: string; description: string | null; eventTypes: string[]; format: string } {
  const url = readText(formData, "url");
  if (!url) throw invalid("Enter the endpoint's https address.", { fields: { url: "Required." } });
  const all = readFlag(formData, "allEvents");
  const eventTypes = all ? ["*"] : readAll(formData, "eventTypes");
  if (eventTypes.length === 0) throw invalid("Choose at least one event, or all events.", { fields: { eventTypes: "Choose at least one event." } });
  return { url, description: readOptional(formData, "description"), eventTypes, format: readText(formData, "format") || "native" };
}

export function webhookEventsFromForm(formData: FormData): string[] {
  const all = readFlag(formData, "allEvents");
  const eventTypes = all ? ["*"] : readAll(formData, "eventTypes");
  if (eventTypes.length === 0) throw invalid("Choose at least one event, or all events.", { fields: { eventTypes: "Choose at least one event." } });
  return eventTypes;
}

/* ------------------------------------------------------------------------------------------- signup */

export function signupFromForm(formData: FormData): { name: string; ein: string | null; city: string | null; state: string } {
  const name = readText(formData, "name");
  if (!name) throw invalid("Enter your organization's name.", { fields: { name: "Required." } });
  if (!readFlag(formData, "testModeUnderstood")) throw invalid("Confirm that you understand the workspace starts in test mode.", { fields: { testModeUnderstood: "Required." } });
  return { name, ein: readOptional(formData, "ein"), city: readOptional(formData, "city"), state: (readText(formData, "state") || "TX").toUpperCase() };
}
