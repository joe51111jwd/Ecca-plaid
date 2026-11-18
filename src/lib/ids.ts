import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghijkmnopqrstuvwxyz"; // no I, L, O, U, l

function randomString(len: number): string {
  const out: string[] = [];
  // Rejection sampling keeps the distribution uniform.
  const max = 256 - (256 % ALPHABET.length);
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b < max && out.length < len) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return out.join("");
}

/** Prefixes for every entity. Public identifiers look like `ver_3Zk9...`. */
export const ID_PREFIX = {
  user: "usr",
  org: "org",
  membership: "mem",
  session: "ses",
  magicLink: "mlk",
  apiKey: "key",
  webhookEndpoint: "whe",
  webhookDelivery: "whd",
  event: "evt",
  job: "job",
  audit: "aud",
  email: "eml",
  object: "obj",
  household: "hh",
  member: "hm",
  consent: "con",
  verification: "ver",
  verificationEvent: "vev",
  document: "doc",
  incomeItem: "inc",
  railConnection: "rail",
  reviewTask: "rev",
  award: "awd",
  donor: "dnr",
  checkout: "chk",
  payment: "pay",
  donation: "don",
  acknowledgment: "ack",
  donorNumber: "udn",
  irsReport: "irs",
  fee: "fee",
  handoff: "ho",
  invoice: "inv",
  invoiceLine: "inl",
  listEntry: "sle",
} as const;

export type IdKind = keyof typeof ID_PREFIX;

export function newId(kind: IdKind): string {
  return `${ID_PREFIX[kind]}_${randomString(22)}`;
}

/** URL-safe secret token (default 32 bytes = 256 bits). Store only its hash. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Numeric one-time code, e.g. the 6-digit sign-in code that accompanies a magic link. */
export function newNumericCode(digits = 6): string {
  let s = "";
  while (s.length < digits) {
    for (const b of randomBytes(digits * 2)) {
      if (b < 250 && s.length < digits) s += String(b % 10);
    }
  }
  return s;
}
