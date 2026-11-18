import { canonicalJson, sha256Hex } from "@/lib/crypto";
import { invalid } from "@/lib/errors";

/**
 * Versioned plain-language consent copy, English and Spanish.
 *
 * Each grant stores the version id and the SHA-256 of the exact words shown (docs/architecture.md, copy
 * rules). Wording is therefore frozen per version: to change a single character, add a new version and
 * point CURRENT_VERSION at it. copy.test.ts locks the hash of every published version so an accidental edit
 * fails the build. Old versions stay in the registry so stored grants can always be re-rendered and checked.
 *
 * Writing rules: sixth-to-eighth-grade reading level, short sentences, "you"/"usted". Each text says who
 * receives what, for what purpose and for how long, what is not shared, how to say no and how to take it back.
 * Proposed-rule content is described as "the proposed federal rules" (never as settled law).
 *
 * Placeholders are `{name}`. Rendering is a single pass, so a value that itself contains braces (an
 * organization called "{shareUntil}", say) is inserted literally and never expanded.
 */

export type ConsentCopyKind = "verification_share" | "rail_connect" | "passport_reuse" | "electronic_delivery";
export type ConsentLocale = "en" | "es";

export const CONSENT_COPY_KINDS: readonly ConsentCopyKind[] = ["verification_share", "rail_connect", "passport_reuse", "electronic_delivery"];
export const CONSENT_LOCALES: readonly ConsentLocale[] = ["en", "es"];

/** A structured value of the scope template: a literal code, a list of codes, or a "{placeholder}". */
export type ScopeTemplateValue = string | readonly string[];

export interface ConsentCopyEntry {
  kind: ConsentCopyKind;
  /** e.g. "verification_share.v1". Shared by the English and Spanish text of the same version. */
  version: string;
  locale: ConsentLocale;
  title: string;
  paragraphs: readonly string[];
  checkboxLabel: string;
  /**
   * Machine-readable "who receives what, for what purpose, for how long". Identical keys in every locale.
   * A value that is exactly one placeholder takes the typed variable (a number stays a number, a date stays
   * ISO); placeholders inside longer strings are replaced as text.
   */
  scope: Readonly<Record<string, ScopeTemplateValue>>;
}

/** Variables each kind needs. Dates are YYYY-MM-DD and are written out in words in the shown text. */
export interface ConsentVarsByKind {
  verification_share: { organizationName: string; shareUntil: string; uploadRetentionDays: number };
  rail_connect: { organizationName: string; providerName: string; incomeYear: number };
  passport_reuse: { organizationName: string; decidedDate: string; resultValidUntil: string; shareUntil: string };
  electronic_delivery: { email: string };
}

type VarType = "text" | "date" | "int" | "email";

/** Variable names and types per kind. renderConsent rejects missing, extra or malformed variables. */
export const CONSENT_VAR_TYPES: { readonly [K in ConsentCopyKind]: Readonly<Record<keyof ConsentVarsByKind[K], VarType>> } = {
  verification_share: { organizationName: "text", shareUntil: "date", uploadRetentionDays: "int" },
  rail_connect: { organizationName: "text", providerName: "text", incomeYear: "int" },
  passport_reuse: { organizationName: "text", decidedDate: "date", resultValidUntil: "date", shareUntil: "date" },
  electronic_delivery: { email: "email" },
};

/* ------------------------------------------------------------------------------------ scope templates */

const SHARED_WITH_SGO = ["decision", "facts_used", "extracted_document_fields", "document_hashes", "uploaded_documents_for_review"] as const;
const NEVER_SHARED = ["bank_or_payroll_login", "full_social_security_number"] as const;

const SCOPE = {
  verification_share: {
    purpose: "scholarship_income_eligibility",
    instructedBy: "household_owner_in_writing",
    recipient: "{organizationName}",
    collected: ["household_members", "address_and_county", "prior_year_income_evidence", "student_birth_date_if_required"],
    shared: SHARED_WITH_SGO,
    notShared: NEVER_SHARED,
    shareUntil: "{shareUntil}",
    uploadRetentionDays: "{uploadRetentionDays}",
    recipientKeeps: ["decision", "facts_used", "document_hashes"],
    sale: "never",
    creditCheck: "no",
    withdraw: "account_page",
  },
  rail_connect: {
    purpose: "prior_year_income_retrieval",
    provider: "{providerName}",
    recipient: "{organizationName}",
    retrieved: ["pay_and_deposit_records", "payer_names"],
    incomeYear: "{incomeYear}",
    notRetained: ["bank_or_payroll_login"],
    optional: "yes",
    alternative: "upload_documents",
    withdraw: "account_page",
  },
  passport_reuse: {
    purpose: "scholarship_income_eligibility_reuse",
    instructedBy: "household_owner_in_writing",
    recipient: "{organizationName}",
    shared: SHARED_WITH_SGO,
    notShared: NEVER_SHARED,
    decidedDate: "{decidedDate}",
    resultValidUntil: "{resultValidUntil}",
    shareUntil: "{shareUntil}",
    sale: "never",
    creditCheck: "no",
    withdraw: "account_page",
  },
  electronic_delivery: {
    purpose: "electronic_delivery_of_notices_and_records",
    channels: ["email", "account_page"],
    email: "{email}",
    withdraw: "account_page",
  },
} as const satisfies Record<ConsentCopyKind, Record<string, ScopeTemplateValue>>;

/* ------------------------------------------------------------------------------------------- copy */

const VERIFICATION_SHARE_V1: Record<ConsentLocale, Omit<ConsentCopyEntry, "kind" | "version" | "locale" | "scope">> = {
  en: {
    title: "Permission to check your income and share the result with {organizationName}",
    paragraphs: [
      "{organizationName} is a scholarship organization. To decide if your child can get a scholarship, it must check that your household's income is not over the limit in the proposed federal rules. You are asking us to do that check for you and to send the result to {organizationName}.",
      "What we collect: the names of the people who live with your child, your address and county, and proof of your household's income for last year. If {organizationName} needs it, we also collect your child's date of birth. Proof of income can be documents you upload, like tax forms, W-2s, pay stubs or a benefits letter. It can also be income records from a payroll or bank service, but only if you choose to connect one.",
      "What {organizationName} gets: the result (eligible, not eligible, or needs review), the facts we used (household size, county, the income limit and the income we counted), the information we read from your documents, and a digital fingerprint of each file that shows it was not changed. If a person at {organizationName} needs to review your case, they can also see the documents you uploaded.",
      "What {organizationName} does not get: your bank or payroll password. We never see or keep it. We do not keep full Social Security numbers. At most, we keep the last 4 digits.",
      "This is not a credit check. It does not affect your credit score. We do not sell your information.",
      "How long: this permission lasts until {shareUntil}. We delete the files you upload {uploadRetentionDays} days after the decision. {organizationName} keeps the result, the facts we used and the file fingerprints as its record of the check.",
      "You can say no: you do not have to agree. If you do not agree, we cannot check your income here. You can ask {organizationName} about other ways to apply.",
      "You can change your mind: you can take back this permission at any time from your account page. We will then stop collecting and sharing your information. What we already sent to {organizationName} stays with them.",
    ],
    checkboxLabel:
      "I am the adult in charge of this household. By checking this box, I give you my written instruction to collect this information and share the result with {organizationName}, as described above.",
  },
  es: {
    title: "Permiso para revisar sus ingresos y compartir el resultado con {organizationName}",
    paragraphs: [
      "{organizationName} es una organización de becas. Para decidir si su hijo o hija puede recibir una beca, tiene que confirmar que los ingresos de su hogar no pasan del límite de las reglas federales propuestas. Usted nos pide hacer esa revisión por usted y enviarle el resultado a {organizationName}.",
      "Lo que recopilamos: los nombres de las personas que viven con su hijo o hija, su dirección y condado, y comprobantes de los ingresos de su hogar del año pasado. Si {organizationName} lo necesita, también recopilamos la fecha de nacimiento de su hijo o hija. Los comprobantes pueden ser documentos que usted sube, como declaraciones de impuestos, formularios W-2, talones de pago o una carta de beneficios. También pueden ser registros de ingresos de un servicio de nómina o de su banco, pero solo si usted decide conectarlo.",
      "Lo que recibe {organizationName}: el resultado (elegible, no elegible o necesita revisión), los datos que usamos (el tamaño del hogar, el condado, el límite de ingresos y los ingresos que contamos), la información que leímos de sus documentos y una huella digital de cada archivo que muestra que no se cambió. Si una persona de {organizationName} necesita revisar su caso, también puede ver los documentos que usted subió.",
      "Lo que no recibe {organizationName}: la contraseña de su banco o de su nómina. Nosotros nunca la vemos ni la guardamos. No guardamos números de Seguro Social completos. Como máximo, guardamos los últimos 4 dígitos.",
      "Esto no es una revisión de crédito. No afecta su puntaje de crédito. No vendemos su información.",
      "Por cuánto tiempo: este permiso dura hasta el {shareUntil}. Borramos los archivos que usted sube {uploadRetentionDays} días después de la decisión. {organizationName} guarda el resultado, los datos que usamos y las huellas digitales de los archivos como su registro de la revisión.",
      "Usted puede decir que no: no tiene que aceptar. Si no acepta, no podemos revisar sus ingresos aquí. Puede preguntarle a {organizationName} sobre otras formas de presentar su solicitud.",
      "Usted puede cambiar de opinión: puede retirar este permiso en cualquier momento desde la página de su cuenta. Entonces dejaremos de recopilar y compartir su información. Lo que ya le enviamos a {organizationName} se queda con ellos.",
    ],
    checkboxLabel:
      "Soy la persona adulta a cargo de este hogar. Al marcar esta casilla, les doy mi instrucción por escrito para recopilar esta información y compartir el resultado con {organizationName}, como se explica arriba.",
  },
};

const RAIL_CONNECT_V1: Record<ConsentLocale, Omit<ConsentCopyEntry, "kind" | "version" | "locale" | "scope">> = {
  en: {
    title: "Connect a payroll or bank account through {providerName}",
    paragraphs: [
      "You can let {providerName} send us your income records instead of uploading documents. {providerName} is a service that gets pay and deposit records from your employer or bank, with your permission.",
      "What we get: records of the pay and deposits you received in {incomeYear}, and the names of the employers or others who paid you. We use them only to figure out your household's income for the scholarship check with {organizationName}.",
      "You sign in on a secure {providerName} screen. We never see or keep your password.",
      "You do not have to connect. You can upload documents instead. You will not lose anything you have already done.",
      "You can disconnect at any time from your account page. When you do, we stop getting new records.",
    ],
    checkboxLabel: "I want to connect my account through {providerName} and let you get my income records for {incomeYear}.",
  },
  es: {
    title: "Conectar una cuenta de nómina o de banco por medio de {providerName}",
    paragraphs: [
      "Puede permitir que {providerName} nos envíe sus registros de ingresos en lugar de subir documentos. {providerName} es un servicio que obtiene registros de pagos y depósitos de su empleador o de su banco, con su permiso.",
      "Lo que recibimos: los registros de los pagos y depósitos que usted recibió en {incomeYear} y los nombres de los empleadores u otras personas que le pagaron. Solo los usamos para calcular los ingresos de su hogar para la revisión de la beca con {organizationName}.",
      "Usted inicia sesión en una pantalla segura de {providerName}. Nosotros nunca vemos ni guardamos su contraseña.",
      "No tiene que conectar su cuenta. Puede subir documentos en su lugar. No perderá nada de lo que ya hizo.",
      "Puede desconectar su cuenta en cualquier momento desde la página de su cuenta. Cuando lo haga, dejaremos de recibir registros nuevos.",
    ],
    checkboxLabel: "Quiero conectar mi cuenta por medio de {providerName} y permitirles recibir mis registros de ingresos de {incomeYear}.",
  },
};

const PASSPORT_REUSE_V1: Record<ConsentLocale, Omit<ConsentCopyEntry, "kind" | "version" | "locale" | "scope">> = {
  en: {
    title: "Share your income check result with {organizationName}",
    paragraphs: [
      "You finished an income check on {decidedDate}. The result can be used until {resultValidUntil}. You can let {organizationName} use that same result, so you do not have to start over.",
      "What {organizationName} gets: the same things the first organization got. That is the result, the facts we used, the information we read from your documents, and a digital fingerprint of each file. If a person at {organizationName} needs to review your case, they can also see the documents you uploaded, if we still have them.",
      "This is a new permission, just for {organizationName}. It does not change any permission you gave before.",
      "This is not a credit check, and we do not sell your information. Your bank or payroll password is never shared.",
      "How long: this permission lasts until {shareUntil}. You can take it back at any time from your account page. What we already sent to {organizationName} stays with them.",
      "You do not have to agree. If you do not agree, you can do a new income check for {organizationName} instead.",
    ],
    checkboxLabel:
      "I am the adult in charge of this household. By checking this box, I give you my written instruction to share my income check result with {organizationName}, as described above.",
  },
  es: {
    title: "Compartir el resultado de su revisión de ingresos con {organizationName}",
    paragraphs: [
      "Usted terminó una revisión de ingresos el {decidedDate}. El resultado se puede usar hasta el {resultValidUntil}. Puede permitir que {organizationName} use ese mismo resultado para que no tenga que empezar de nuevo.",
      "Lo que recibe {organizationName}: lo mismo que recibió la primera organización. Es decir, el resultado, los datos que usamos, la información que leímos de sus documentos y una huella digital de cada archivo. Si una persona de {organizationName} necesita revisar su caso, también puede ver los documentos que usted subió, si todavía los tenemos.",
      "Este es un permiso nuevo, solo para {organizationName}. No cambia ningún permiso que usted dio antes.",
      "Esto no es una revisión de crédito y no vendemos su información. Nunca compartimos la contraseña de su banco o de su nómina.",
      "Por cuánto tiempo: este permiso dura hasta el {shareUntil}. Puede retirarlo en cualquier momento desde la página de su cuenta. Lo que ya le enviamos a {organizationName} se queda con ellos.",
      "No tiene que aceptar. Si no acepta, puede hacer una revisión de ingresos nueva para {organizationName}.",
    ],
    checkboxLabel:
      "Soy la persona adulta a cargo de este hogar. Al marcar esta casilla, les doy mi instrucción por escrito para compartir el resultado de mi revisión de ingresos con {organizationName}, como se explica arriba.",
  },
};

const ELECTRONIC_DELIVERY_V1: Record<ConsentLocale, Omit<ConsentCopyEntry, "kind" | "version" | "locale" | "scope">> = {
  en: {
    title: "Get your notices and records by email",
    paragraphs: [
      "We will send notices and records about your income check by email to {email} and show them on your account page, instead of sending them on paper. This includes updates, requests for more information and your result.",
      "To read them, you need a phone or computer that can open web pages and PDF files. You can download or print any record from your account page.",
      "Please check that {email} is right. If it is wrong, you will not get our messages.",
      "You can take back this agreement at any time from your account page.",
    ],
    checkboxLabel: "I agree to get notices and records by email and on my account page.",
  },
  es: {
    title: "Reciba sus avisos y registros por correo electrónico",
    paragraphs: [
      "Le enviaremos avisos y registros sobre su revisión de ingresos por correo electrónico a {email} y los mostraremos en la página de su cuenta, en lugar de enviarlos en papel. Esto incluye novedades, pedidos de más información y su resultado.",
      "Para leerlos, necesita un teléfono o una computadora que pueda abrir páginas web y archivos PDF. Puede descargar o imprimir cualquier registro desde la página de su cuenta.",
      "Revise que {email} esté correcto. Si no lo está, no recibirá nuestros mensajes.",
      "Puede retirar este acuerdo en cualquier momento desde la página de su cuenta.",
    ],
    checkboxLabel: "Acepto recibir avisos y registros por correo electrónico y en la página de mi cuenta.",
  },
};

function entries(kind: ConsentCopyKind, version: string, text: Record<ConsentLocale, Omit<ConsentCopyEntry, "kind" | "version" | "locale" | "scope">>): ConsentCopyEntry[] {
  return CONSENT_LOCALES.map((locale) => deepFreeze({ kind, version, locale, scope: SCOPE[kind], ...text[locale] }));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** Every published version, in every locale. Never edit an entry: add a new version instead. */
export const CONSENT_COPY: readonly ConsentCopyEntry[] = Object.freeze([
  ...entries("verification_share", "verification_share.v1", VERIFICATION_SHARE_V1),
  ...entries("rail_connect", "rail_connect.v1", RAIL_CONNECT_V1),
  ...entries("passport_reuse", "passport_reuse.v1", PASSPORT_REUSE_V1),
  ...entries("electronic_delivery", "electronic_delivery.v1", ELECTRONIC_DELIVERY_V1),
]);

/** The version shown for new grants. */
export const CURRENT_CONSENT_VERSION: Readonly<Record<ConsentCopyKind, string>> = Object.freeze({
  verification_share: "verification_share.v1",
  rail_connect: "rail_connect.v1",
  passport_reuse: "passport_reuse.v1",
  electronic_delivery: "electronic_delivery.v1",
});

export function isConsentCopyKind(value: unknown): value is ConsentCopyKind {
  return typeof value === "string" && (CONSENT_COPY_KINDS as readonly string[]).includes(value);
}

export function isConsentLocale(value: unknown): value is ConsentLocale {
  return value === "en" || value === "es";
}

/** A specific version in a specific locale, or null. */
export function getConsentCopy(version: string, locale: ConsentLocale): ConsentCopyEntry | null {
  return CONSENT_COPY.find((e) => e.version === version && e.locale === locale) ?? null;
}

/** SHA-256 of a copy entry's template (canonical JSON). Locked per version by copy.test.ts. */
export function consentTemplateSha256(entry: ConsentCopyEntry): string {
  const { kind, version, locale, title, paragraphs, checkboxLabel, scope } = entry;
  return sha256Hex(canonicalJson({ kind, version, locale, title, paragraphs: [...paragraphs], checkboxLabel, scope: JSON.parse(JSON.stringify(scope)) as unknown }));
}

/** Every `{placeholder}` name used anywhere in an entry (text and scope), sorted. */
export function placeholdersOf(entry: ConsentCopyEntry): string[] {
  const found = new Set<string>();
  const scan = (s: string) => {
    for (const m of s.matchAll(PLACEHOLDER)) found.add(m[1]!);
  };
  scan(entry.title);
  entry.paragraphs.forEach(scan);
  scan(entry.checkboxLabel);
  for (const v of Object.values(entry.scope)) (typeof v === "string" ? [v] : v).forEach(scan);
  return [...found].sort();
}

/* --------------------------------------------------------------------------------------- rendering */

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
const MONTHS: Record<ConsentLocale, readonly string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
};
const MAX_TEXT_VAR_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "2027-06-30" → "June 30, 2027" / "30 de junio de 2027". Spelled out by hand so the words never depend on the ICU version. */
export function formatConsentDate(iso: string, locale: ConsentLocale): string {
  const [y, m, d] = iso.split("-").map(Number);
  const month = MONTHS[locale][m! - 1]!;
  return locale === "es" ? `${d} de ${month} de ${y}` : `${month} ${d}, ${y}`;
}

function isRealIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const probe = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return probe.toISOString().slice(0, 10) === value;
}

type VarValue = string | number;

function checkVars(kind: ConsentCopyKind, vars: Record<string, unknown>): Record<string, VarValue> {
  const types = CONSENT_VAR_TYPES[kind] as Record<string, VarType>;
  const fields: Record<string, string> = {};
  const out: Record<string, VarValue> = {};
  for (const key of Object.keys(vars)) if (!(key in types)) fields[key] = "Not used by this consent.";
  for (const [key, type] of Object.entries(types)) {
    const raw = vars[key];
    if (type === "int") {
      if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) fields[key] = "Must be a whole number.";
      else out[key] = raw;
      continue;
    }
    if (typeof raw !== "string") {
      fields[key] = "Required.";
      continue;
    }
    const v = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    if (type === "date" && !isRealIsoDate(v)) fields[key] = "Must be a date as YYYY-MM-DD.";
    else if (type === "email" && (!EMAIL_PATTERN.test(v) || v.length > 254)) fields[key] = "Must be an email address.";
    else if (type === "text" && (v.length === 0 || v.length > MAX_TEXT_VAR_LENGTH)) fields[key] = `Must be 1 to ${MAX_TEXT_VAR_LENGTH} characters.`;
    else out[key] = v;
  }
  if (Object.keys(fields).length > 0) throw invalid("The consent text could not be prepared.", { fields });
  return out;
}

function fill(template: string, vars: Record<string, VarValue>, kind: ConsentCopyKind, locale: ConsentLocale): string {
  const types = CONSENT_VAR_TYPES[kind] as Record<string, VarType>;
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    if (!(name in vars)) throw new Error(`Consent copy uses {${name}}, which ${kind} does not define`);
    const v = vars[name]!;
    return types[name] === "date" ? formatConsentDate(String(v), locale) : String(v);
  });
}

export type RenderedScope = Record<string, string | number | string[]>;

export interface RenderedConsent {
  kind: ConsentCopyKind;
  version: string;
  locale: ConsentLocale;
  title: string;
  paragraphs: string[];
  checkboxLabel: string;
  /** The exact string shown: title, paragraphs and checkbox label separated by blank lines. */
  text: string;
  /** SHA-256 (hex) of `text`, stored with the grant. */
  sha256: string;
  scope: RenderedScope;
  /** The checked variables, as used (store them to re-render and re-check the hash later). */
  vars: Record<string, VarValue>;
}

/** Joins the parts exactly as they are hashed. UIs show the same parts; this is the canonical string. */
export function consentText(title: string, paragraphs: readonly string[], checkboxLabel: string): string {
  return [title, ...paragraphs, checkboxLabel].join("\n\n");
}

/**
 * Renders a consent for display and for storage. Uses the current version unless `version` is given (to
 * re-render a stored grant). Throws validation_failed for missing, extra or malformed variables.
 */
export function renderConsent<K extends ConsentCopyKind>(kind: K, locale: ConsentLocale, vars: ConsentVarsByKind[K], opts: { version?: string } = {}): RenderedConsent {
  if (!isConsentCopyKind(kind)) throw invalid("Unknown consent kind.");
  if (!isConsentLocale(locale)) throw invalid("Unknown language.");
  const version = opts.version ?? CURRENT_CONSENT_VERSION[kind];
  const entry = getConsentCopy(version, locale);
  if (!entry || entry.kind !== kind) throw invalid(`Unknown consent version ${version}.`);
  const checked = checkVars(kind, vars as unknown as Record<string, unknown>);

  const title = fill(entry.title, checked, kind, locale);
  const paragraphs = entry.paragraphs.map((p) => fill(p, checked, kind, locale));
  const checkboxLabel = fill(entry.checkboxLabel, checked, kind, locale);
  const scope: RenderedScope = {};
  for (const [key, value] of Object.entries(entry.scope)) {
    if (typeof value !== "string") {
      scope[key] = [...value];
      continue;
    }
    const only = /^\{([A-Za-z][A-Za-z0-9]*)\}$/.exec(value);
    scope[key] = only && only[1]! in checked ? checked[only[1]!]! : value.replace(PLACEHOLDER, (_w, n: string) => String(checked[n] ?? ""));
  }
  const text = consentText(title, paragraphs, checkboxLabel);
  return { kind, version, locale, title, paragraphs, checkboxLabel, text, sha256: sha256Hex(text), scope, vars: checked };
}
