/**
 * Conservative person-name matching: "is the person named on this document a member of this household?"
 *
 * Normalisation: case, accents, punctuation, generational suffixes (JR, SR, II-V), `LAST, FIRST M` order,
 * single-letter middle initials, hyphenated surnames and the two-surname Hispanic pattern (paternal plus
 * maternal surname, optionally joined by `Y`, `DE`, `DEL`, `DE LA`).
 *
 * Grades:
 *  - `exact`  the normalised names are the same.
 *  - `strong` same given name and the surnames agree under one documented variation: one surname set contains
 *             the other (MARIA ALVAREZ GARCIA / MARIA ALVAREZ), hyphen vs space, a middle name present on one
 *             side only, or a one-letter typo in a given name or surname of five or more letters (P0 name rule).
 *  - `weak`   the surname agrees but the given name only by initial or prefix (incl. IRS 4-letter masks, H2),
 *             or a one-letter difference in a short name. Weak always goes to a reviewer.
 *  - `none`   anything else.
 * No nickname guessing: BOB never matches ROBERT.
 */

export type NameMatchGrade = "exact" | "strong" | "weak" | "none";

export interface NameMatch {
  grade: NameMatchGrade;
  confidence: number;
  reasons: string[];
}

export interface PersonName {
  firstName: string;
  middleName?: string | null;
  lastName?: string | null;
}

export interface HouseholdPerson extends PersonName {
  id: string;
}

export const NAME_GRADE_CONFIDENCE: Readonly<Record<NameMatchGrade, number>> = Object.freeze({
  exact: 1,
  strong: 0.85,
  weak: 0.5,
  none: 0,
});

/** Edit-distance-1 tolerance applies only to tokens at least this long (author's choice; P0 name rule). */
export const TYPO_MIN_TOKEN_LENGTH = 5;

const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V", "2ND", "3RD", "4TH"]);
const SURNAME_PARTICLES = new Set(["Y", "DE", "DEL", "LA", "LAS", "LOS", "DA", "DI", "VAN", "VON", "DER"]);

export interface NormalizedName {
  given: string[];
  surnames: string[];
  /** Every token, in natural (given-first) order. */
  all: string[];
}

function cleanTokens(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/['’`.]/g, "")
    .replace(/[^A-Z,\- ]/g, " ")
    .split(/[\s-]+/)
    .map((t) => t.replace(/,/g, ""))
    .filter((t) => t.length > 0 && !SUFFIXES.has(t));
}

/**
 * Splits a printed full name. `ALVAREZ, MARIA E` (comma form) is reordered. Without a comma the last token
 * group is the surname; tokens after the first given name that are particles or follow a particle are surname.
 */
export function normalizeFullName(printed: string): NormalizedName {
  const raw = printed.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (raw.includes(",")) {
    const [last, ...rest] = raw.split(",");
    const lastTokens = cleanTokens(last).filter((t) => !SURNAME_PARTICLES.has(t));
    const givenTokens = cleanTokens(rest.join(" ")).filter((t) => t.length > 1);
    return { given: givenTokens, surnames: lastTokens, all: [...givenTokens, ...lastTokens] };
  }
  // A hyphenated last word is a compound surname (ALVAREZ-GARCIA), never a middle name plus surname.
  const words = raw.trim().split(/\s+/);
  const last = words[words.length - 1] ?? "";
  if (words.length >= 2 && /[A-Za-z]-[A-Za-z]/.test(last) && !/,/.test(raw)) {
    const surnames = cleanTokens(last);
    const given = cleanTokens(words.slice(0, -1).join(" ")).filter((t, i) => i === 0 || t.length > 1);
    if (given.length > 0 && surnames.length > 0) return { given, surnames, all: [...given, ...surnames] };
  }
  const tokens = cleanTokens(raw);
  if (tokens.length <= 1) return { given: tokens, surnames: [], all: tokens };
  const first = tokens[0];
  const rest = tokens.slice(1);
  // Single-letter middle initials carry no matching weight.
  const meaningful = rest.filter((t) => t.length > 1);
  if (meaningful.length === 0) return { given: [first], surnames: [], all: [first] };
  // A particle starts the surname group (MARIA DE LA CRUZ → surname CRUZ).
  const particleAt = rest.findIndex((t) => SURNAME_PARTICLES.has(t));
  let surnames: string[];
  let middles: string[];
  if (particleAt >= 0) {
    middles = rest.slice(0, particleAt).filter((t) => t.length > 1);
    surnames = rest.slice(particleAt).filter((t) => !SURNAME_PARTICLES.has(t) && t.length > 1);
    if (surnames.length === 0) {
      surnames = middles.slice(-1);
      middles = middles.slice(0, -1);
    }
  } else {
    surnames = [meaningful[meaningful.length - 1]];
    middles = meaningful.slice(0, -1);
  }
  return { given: [first, ...middles], surnames, all: [first, ...middles, ...surnames] };
}

function normalizePerson(p: PersonName): NormalizedName {
  const given = cleanTokens(`${p.firstName} ${p.middleName ?? ""}`).filter((t, i) => i === 0 || t.length > 1);
  const surnames = cleanTokens(p.lastName ?? "").filter((t) => !SURNAME_PARTICLES.has(t));
  return { given, surnames, all: [...given, ...surnames] };
}

/** Levenshtein distance, early exit above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

type TokenAgreement = "same" | "typo" | "short_typo" | "initial" | "prefix" | "different";

function compareToken(a: string, b: string): TokenAgreement {
  if (a === b) return "same";
  if (a.length === 1 || b.length === 1) return a[0] === b[0] ? "initial" : "different";
  // IRS masks show the first four letters (three for a four-letter name), H2.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && short.length <= 4 && long.startsWith(short)) return "prefix";
  if (editDistance(a, b, 1) === 1) return Math.min(a.length, b.length) >= TYPO_MIN_TOKEN_LENGTH ? "typo" : "short_typo";
  return "different";
}

function surnameAgreement(doc: string[], member: string[]): { agreement: TokenAgreement; note: string | null } {
  if (doc.length === 0 || member.length === 0) return { agreement: "different", note: null };
  const docJoined = doc.join("");
  const memberJoined = member.join("");
  if (docJoined === memberJoined) return { agreement: "same", note: doc.length === member.length ? null : "hyphenated surname" };
  const docSet = new Set(doc);
  const memberSet = new Set(member);
  const shared = [...docSet].filter((t) => memberSet.has(t));
  if (shared.length > 0 && (shared.length === docSet.size || shared.length === memberSet.size)) {
    return { agreement: "same", note: "one of two surnames" };
  }
  // Compare the first (paternal) surnames token by token.
  const agreement = compareToken(doc[0], member[0]);
  return { agreement, note: null };
}

/**
 * Without a comma or hyphen, "MARIA ALVAREZ GARCIA" may be given name plus two surnames, or given name,
 * middle name and surname. Both readings are tried and the better grade wins (unless the household gave a
 * middle name to compare).
 */
function readings(printed: string, person: PersonName): NormalizedName[] {
  const primary = normalizeFullName(printed);
  // When the household recorded a middle name, the printed middle word is compared with it instead.
  if (person.middleName?.trim()) return [primary];
  if (printed.includes(",") || primary.given.length < 2 || primary.surnames.length !== 1) return [primary];
  const given = primary.given.slice(0, 1);
  const surnames = [...primary.given.slice(1), ...primary.surnames];
  return [primary, { given, surnames, all: [...given, ...surnames] }];
}

export function matchPersonName(printed: string, person: PersonName): NameMatch {
  let best: NameMatch | null = null;
  for (const doc of readings(printed, person)) {
    const r = matchNormalized(doc, person);
    if (!best || GRADE_ORDER[r.grade] > GRADE_ORDER[best.grade]) best = r;
  }
  return best!;
}

function matchNormalized(doc: NormalizedName, person: PersonName): NameMatch {
  const mem = normalizePerson(person);
  const reasons: string[] = [];
  const result = (grade: NameMatchGrade): NameMatch => ({ grade, confidence: NAME_GRADE_CONFIDENCE[grade], reasons });
  if (doc.given.length === 0 || mem.given.length === 0) {
    reasons.push("no given name to compare");
    return result("none");
  }
  if (doc.all.join(" ") === mem.all.join(" ")) {
    reasons.push("names are identical after normalisation");
    return result("exact");
  }
  const sur = surnameAgreement(doc.surnames, mem.surnames);
  const given = compareToken(doc.given[0], mem.given[0]);
  if (sur.agreement === "different" || sur.agreement === "initial") {
    reasons.push("surnames differ");
    return result("none");
  }
  if (given === "different") {
    reasons.push("given names differ");
    return result("none");
  }
  if (sur.note) reasons.push(sur.note);
  if (given === "same" && sur.agreement === "same") {
    const docMiddles = doc.given.slice(1);
    const memMiddles = mem.given.slice(1);
    if (docMiddles.length > 0 && memMiddles.length > 0 && docMiddles.join(" ") !== memMiddles.join(" ")) {
      const compatible = docMiddles.every((m, i) => memMiddles[i] !== undefined && (memMiddles[i] === m || memMiddles[i][0] === m[0]));
      if (!compatible) {
        reasons.push("middle names differ");
        return result("weak");
      }
    }
    reasons.push(docMiddles.length !== memMiddles.length ? "middle name on one side only" : "same given name and surname");
    return result("strong");
  }
  const parts = [given, sur.agreement];
  if (parts.every((p) => p === "same" || p === "typo")) {
    reasons.push("one-letter difference in a long name");
    return result("strong");
  }
  reasons.push(`given name ${given}, surname ${sur.agreement}`);
  return result("weak");
}

export interface HouseholdNameMatch extends NameMatch {
  memberId: string | null;
  /** True when two or more members match equally well (e.g. a parent and child with the same name). */
  ambiguous: boolean;
}

const GRADE_ORDER: Readonly<Record<NameMatchGrade, number>> = { exact: 3, strong: 2, weak: 1, none: 0 };

/** Best match of a printed name among household members. */
export function matchNameToHousehold(printed: string, members: readonly HouseholdPerson[]): HouseholdNameMatch {
  let best: HouseholdNameMatch = { grade: "none", confidence: 0, reasons: ["no household member matches"], memberId: null, ambiguous: false };
  for (const m of members) {
    const r = matchPersonName(printed, m);
    if (GRADE_ORDER[r.grade] > GRADE_ORDER[best.grade]) best = { ...r, memberId: m.id, ambiguous: false };
    else if (r.grade !== "none" && GRADE_ORDER[r.grade] === GRADE_ORDER[best.grade]) best = { ...best, ambiguous: true };
  }
  return best;
}
