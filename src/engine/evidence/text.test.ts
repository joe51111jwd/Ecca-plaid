import { describe, expect, it } from "vitest";
import { isAppError } from "@/lib/errors";
import { formatBytes, formatCalendarDate, formatMoney, formatUtcClock, formatUtcTimestamp, groupHash, humanizeKey, utcDateOf } from "./format";
import { parseJsonStrict } from "./json-strict";
import { EVIDENCE_POLICY } from "./policy";
import { containsSsnPattern, initialsOf, isSensitiveFieldName, normalizeText, removeSsnPatterns, sanitizeFilename } from "./text";

const char = (codePoint: number) => String.fromCodePoint(codePoint);

describe("normalizeText", () => {
  it("composes, trims and collapses white space", () => {
    expect(normalizeText(`  Pen${char(0x0303)}a \t\r\n  Garci${char(0x0301)}a${char(0x2028)}Lo${char(0x0301)}pez${char(0x00a0)}x `)).toBe("Peña García López x");
    expect(normalizeText("")).toBe("");
    expect(normalizeText(" \n\t ")).toBe("");
  });

  it("removes control, zero-width and bidirectional formatting characters", () => {
    const invisible = [0x00, 0x07, 0x08, 0x0b, 0x0c, 0x1b, 0x7f, 0x85, 0x9f, 0xad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202d, 0x202e, 0x2060, 0x2066, 0x2069, 0xfeff];
    for (const codePoint of invisible) expect(normalizeText(`a${char(codePoint)}b`), codePoint.toString(16)).toBe("ab");
    // An escape sequence that would recolor a terminal is reduced to harmless printable characters.
    expect(normalizeText(`${char(0x1b)}[31mred${char(0x1b)}[0m`)).toBe("[31mred[0m");
  });

  it("replaces lone surrogates and keeps real astral characters", () => {
    expect(normalizeText(`a${String.fromCharCode(0xd83d)}b`)).toBe(`a${char(0xfffd)}b`);
    expect(normalizeText(`a${String.fromCharCode(0xde42)}b`)).toBe(`a${char(0xfffd)}b`);
    expect(normalizeText(`a${char(0x1f642)}b`)).toBe(`a${char(0x1f642)}b`);
  });

  it("is idempotent", () => {
    const messy = `  Zoe${char(0x0308)}  ${char(0x200b)}Bronte${char(0x0308)}\n`;
    expect(normalizeText(normalizeText(messy))).toBe(normalizeText(messy));
  });
});

describe("removeSsnPatterns", () => {
  it.each([
    ["SSN 123-45-6789.", `SSN ${EVIDENCE_POLICY.ssnReplacement}.`, 1],
    ["123 45 6789", EVIDENCE_POLICY.ssnReplacement, 1],
    ["123.45.6789", EVIDENCE_POLICY.ssnReplacement, 1],
    [`123${char(0x2013)}45${char(0x2014)}6789`, EVIDENCE_POLICY.ssnReplacement, 1],
    ["123456789", EVIDENCE_POLICY.ssnReplacement, 1],
    ["SSN123456789", `SSN${EVIDENCE_POLICY.ssnReplacement}`, 1],
    ["ssn:123456789;", `ssn:${EVIDENCE_POLICY.ssnReplacement};`, 1],
    ["a 123-45-6789 b 987-65-4321 c 111223333", `a ${EVIDENCE_POLICY.ssnReplacement} b ${EVIDENCE_POLICY.ssnReplacement} c ${EVIDENCE_POLICY.ssnReplacement}`, 3],
  ])("%s", (input, output, removed) => {
    expect(removeSsnPatterns(input)).toEqual({ text: output, removed });
    expect(containsSsnPattern(input)).toBe(true);
    expect(containsSsnPattern(output)).toBe(false);
  });

  it.each([
    "512-555-0100",
    "(512) 555-0100",
    "1234567890",
    "12345678",
    "$1,234,567.89",
    "2026-11-18T15:04:05.000Z",
    "2026-11-18",
    "77002-1234",
    "EIN 12-3456789",
    "1234-56-7890",
    "12-345-6789",
    "ver_SYNTHETICcategorical01",
    "",
  ])("leaves %s alone", (input) => {
    expect(removeSsnPatterns(input)).toEqual({ text: input, removed: 0 });
    expect(containsSsnPattern(input)).toBe(false);
  });

  it("can be called repeatedly without carrying state between calls", () => {
    for (let round = 0; round < 3; round += 1) {
      expect(containsSsnPattern("x 123-45-6789")).toBe(true);
      expect(containsSsnPattern("123456789")).toBe(true);
      expect(containsSsnPattern("nothing here")).toBe(false);
    }
  });
});

describe("isSensitiveFieldName", () => {
  it.each([
    ["dob", "DOB"],
    ["date_of_birth", "x"],
    ["dateOfBirth", "x"],
    ["x", "Date of Birth"],
    ["birthdate", "x"],
    ["employee_birth_date", "x"],
    ["ssn", "x"],
    ["employee_ssn_last4", "x"],
    ["x", "Social Security Number"],
    ["social_security_no", "x"],
    ["recipient_tin", "x"],
    ["itin", "x"],
    ["taxpayer_id", "x"],
    ["x", "Taxpayer identification number"],
    ["account_number", "x"],
    ["bankAccountNumber", "x"],
    ["acct_no", "x"],
    ["routing_number", "x"],
    ["x", "Routing"],
    ["card_number", "x"],
    ["passport_number", "x"],
    ["x", "Driver's License"],
    ["drivers_license_no", "x"],
  ])("%s / %s is sensitive", (key, label) => {
    expect(isSensitiveFieldName(key, label)).toBe(true);
  });

  it.each([
    ["wages_box_1", "Wages, tips, other compensation (box 1)"],
    ["social_security_benefits", "Social Security benefits (box 5)"],
    ["social_security_wages_box_3", "Social security wages"],
    ["employer_name", "Employer"],
    ["employer_ein", "Employer identification number"],
    ["letter_date", "Letter date"],
    ["pay_date", "Pay date"],
    ["program", "Program"],
    ["continuing_education", "Continuing education"],
    ["tax_year", "Tax year"],
    ["account_type", "Account type"],
    ["rerouting", "Rerouting notice"],
    ["gross_pay_ytd", "Gross pay, year to date"],
  ])("%s / %s is not", (key, label) => {
    expect(isSensitiveFieldName(key, label)).toBe(false);
  });
});

describe("sanitizeFilename", () => {
  it.each([
    ["w2-2026.pdf", "w2-2026.pdf"],
    ["/home/parent/Documents/w2 2026.pdf", "w2 2026.pdf"],
    ["C:\\Users\\Parent\\Desktop\\award letter.PDF", "award letter.PDF"],
    ["../../etc/passwd", "passwd"],
    ["..", "unnamed"],
    ["", "unnamed"],
    ["   ", "unnamed"],
    [".htaccess", "htaccess"],
    ['bad<>:"|?*name.pdf', "bad_______name.pdf"],
    [`line${char(0x0a)}break${char(0x00)}.pdf`, "line break.pdf"],
  ])("%j -> %j", (input, output) => {
    expect(sanitizeFilename(input)).toBe(output);
  });

  it("shortens a long name and keeps its extension", () => {
    const result = sanitizeFilename(`${"n".repeat(500)}.jpeg`);
    expect(Array.from(result)).toHaveLength(EVIDENCE_POLICY.limits.filename);
    expect(result.endsWith("~.jpeg")).toBe(true);
    const noExtension = sanitizeFilename("n".repeat(500));
    expect(Array.from(noExtension)).toHaveLength(EVIDENCE_POLICY.limits.filename);
    expect(noExtension.endsWith("~")).toBe(true);
  });
});

describe("initialsOf", () => {
  it.each([
    ["María", "Peña", "M.P."],
    ["josé", "de la cruz", "J.D."],
    ["Élodie", "Ó Briain", "É.Ó."],
    ["  Ana ", "", "A."],
    ["", "Garza", "G."],
    ["", "", ""],
    [char(0x1f642), "Smith", `${char(0x1f642)}.S.`],
  ])("%j %j -> %j", (first, last, initials) => {
    expect(initialsOf(first, last)).toBe(initials);
  });
});

describe("format helpers", () => {
  it("formats money, dates, instants, sizes, hashes and keys", () => {
    expect(formatMoney(31_200_000)).toBe("$312,000.00");
    expect(formatMoney(8_425_037)).toBe("$84,250.37");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(-150)).toBe("-$1.50");
    expect(formatCalendarDate("2026-05-01")).toBe("May 1, 2026");
    expect(formatCalendarDate("2027-12-31")).toBe("December 31, 2027");
    expect(formatUtcTimestamp("2026-11-18T15:04:05.678Z")).toBe("2026-11-18 15:04:05 UTC");
    expect(formatUtcClock("2026-11-18T15:04:05.678Z")).toBe("2026-11-18 15:04:05");
    expect(utcDateOf("2026-11-18T23:59:59.999Z")).toBe("2026-11-18");
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(999)).toBe("999 bytes");
    expect(formatBytes(2_318_554)).toBe("2,318,554 bytes");
    expect(groupHash("ab".repeat(32))).toBe(Array.from({ length: 8 }, () => "abababab").join(" "));
    expect(humanizeKey("verification_share")).toBe("Verification share");
    expect(humanizeKey("retentionYears")).toBe("Retention years");
    expect(humanizeKey("__")).toBe("__");
  });
});

describe("parseJsonStrict", () => {
  function reasonOf(text: string): string {
    try {
      parseJsonStrict(text);
    } catch (error) {
      if (isAppError(error)) return (error.details as { reason: string }).reason;
      throw error;
    }
    return "parsed";
  }

  it("parses what JSON.parse parses", () => {
    const values = [{ a: 1, b: [true, null, "x", { c: { d: [] } }] }, [], "text", 5, null, { "a:b": '{"a":1,"a":2}', "\\": "\"}{" }, { a: { x: 1 }, b: { x: 2 } }, [{ x: 1 }, { x: 2 }]];
    for (const value of values) {
      expect(parseJsonStrict(JSON.stringify(value))).toEqual(value);
      expect(parseJsonStrict(JSON.stringify(value, null, 2))).toEqual(value);
    }
    expect(parseJsonStrict(`${char(0xfeff)}{"a":1}`)).toEqual({ a: 1 });
  });

  it("refuses a repeated member name at any depth, however it is spelled", () => {
    expect(reasonOf('{"a":1,"a":2}')).toBe("duplicate_member");
    expect(reasonOf('{"record":{"mode":"live"},"signature":{},"record":{"mode":"test"}}')).toBe("duplicate_member");
    expect(reasonOf('{"x":{"y":[{"z":1,"z":1}]}}')).toBe("duplicate_member");
    expect(reasonOf('{"a":1,"\\u0061":2}')).toBe("duplicate_member");
    expect(reasonOf('{ "a" : 1 ,\n "a"\t: 2 }')).toBe("duplicate_member");
    try {
      parseJsonStrict('{"record":{"decision":{"status":"eligible","status":"ineligible"}}}');
      throw new Error("expected a refusal");
    } catch (error) {
      expect(isAppError(error) && error.message).toContain('"record.decision.status"');
      expect(isAppError(error) && (error.details as { path: string }).path).toBe("record.decision.status");
    }
  });

  it("does not mistake values or sibling objects for repeats", () => {
    expect(reasonOf('{"a":"a","b":"a"}')).toBe("parsed");
    expect(reasonOf('[{"a":1},{"a":1}]')).toBe("parsed");
    expect(reasonOf('{"a":{"a":{"a":1}}}')).toBe("parsed");
    expect(reasonOf('{"a":"\\"a\\":1","b":"x"}')).toBe("parsed");
    expect(reasonOf('{"k":"a\\\\","a":1}')).toBe("parsed");
  });

  it("refuses invalid JSON", () => {
    for (const text of ["", "{", "{'a':1}", "{a:1}", '{"a":1,}', "undefined", "NaN", '{"a":01}']) expect(reasonOf(text), text).toBe("invalid_json");
  });
});
