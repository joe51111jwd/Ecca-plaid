import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { es } from "@/i18n/es";
import { errorFromQuery, hrefFor, memberName } from "./shared";
import { familyDate, lastValidDay } from "./steps";

describe("errorFromQuery", () => {
  it("shows only sentences from the dictionary, never what the URL says", () => {
    expect(errorFromQuery({ error: "cannotRemoveOwner" }, "es")).toBe(es.errors.cannotRemoveOwner);
    expect(errorFromQuery({ error: ["generic", "x"] }, "en")).toBe(en.errors.generic);
    for (const bad of ["<script>alert(1)</script>", "title", "files", "fields", "toString", "__proto__", "constructor", ""]) {
      expect(errorFromQuery({ error: bad }, "en"), bad).toBeNull();
    }
    expect(errorFromQuery({}, "en")).toBeNull();
  });
});

describe("hrefFor", () => {
  it("keeps Spanish in the URL and leaves English bare", () => {
    expect(hrefFor({ base: "/v/t", locale: "es" }, "people", { edit: "m1" })).toBe("/v/t/people?edit=m1&lang=es");
    expect(hrefFor({ base: "/v/t", locale: "en" }, "review")).toBe("/v/t/review");
  });
});

describe("dates", () => {
  it("writes a calendar date in each language", () => {
    expect(familyDate("2027-03-04", "en")).toBe("March 4, 2027");
    expect(familyDate("2027-03-04", "es")).toBe("4 de marzo de 2027");
    expect(familyDate(null, "en")).toBe("");
  });

  it("uses the US Central day of an instant", () => {
    // 03:00 UTC on March 5 is still March 4 in Texas.
    expect(familyDate(new Date("2027-03-05T03:00:00Z"), "en")).toBe("March 4, 2027");
  });

  it("shows the last valid day of a result that expires at the start of the next Central day", () => {
    expect(lastValidDay(new Date("2027-01-01T06:00:00Z"), "en")).toBe("December 31, 2026");
    expect(lastValidDay(new Date("2027-07-01T05:00:00Z"), "es")).toBe("30 de junio de 2027");
  });
});

describe("memberName", () => {
  it("joins first and last name", () => {
    expect(memberName({ firstName: "Avery", lastName: "Sample" })).toBe("Avery Sample");
    expect(memberName({ firstName: "Avery", lastName: "" })).toBe("Avery");
  });
});
