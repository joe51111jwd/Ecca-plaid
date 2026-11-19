import { describe, expect, it } from "vitest";
import { orgInitials, orgMarkName } from "./org-mark-name";

/* Organization names below are SYNTHETIC. */

describe("orgMarkName", () => {
  it("drops a short label prefix, parenthesised asides and punctuation", () => {
    expect(orgMarkName("Demo: Lone Star Scholarship Fund (sandbox)")).toBe("Lone Star Scholarship Fund");
    expect(orgMarkName("Synthetic IRS-Listed Test Fund")).toBe("IRS-Listed Fund");
    expect(orgMarkName("Camp Cedar Creek [pilot]")).toBe("Camp Cedar Creek");
    expect(orgMarkName("“Bluebonnet” Kids' Fund, Inc.")).toBe("Bluebonnet Kids Fund Inc");
  });

  it("drops filler words but keeps a colon that is part of a longer name", () => {
    expect(orgMarkName("The Fund for the Children of Austin")).toBe("Fund Children Austin");
    expect(orgMarkName("Friends of the Library and Learning: Austin Chapter")).toBe("Friends Library Learning Austin Chapter");
  });

  it("falls back rather than return nothing", () => {
    expect(orgMarkName("The And")).toBe("The And");
    expect(orgMarkName("(sandbox)")).toBe("sandbox");
    expect(orgMarkName("Demo:")).toBe("Demo");
    expect(orgMarkName("— ( ) —")).toBe("— ( ) —");
    expect(orgMarkName("   ")).toBe("");
  });
});

describe("orgInitials", () => {
  it("never shows punctuation as an initial", () => {
    expect(orgInitials("Demo: Lone Star Scholarship Fund (sandbox)")).toBe("LF");
    expect(orgInitials("Demo: Prairie Lantern (sandbox)")).toBe("PL");
    expect(orgInitials("(Pilot) Hill Country Camps")).toBe("HC");
    expect(orgInitials("Austin & Travis County Scholars")).toBe("AS");
  });

  it("keeps plain names as before", () => {
    expect(orgInitials("Camp Cedar Creek")).toBe("CC");
    expect(orgInitials("Prairie Lantern Scholarship Fund")).toBe("PF");
    expect(orgInitials("Cher")).toBe("C");
    expect(orgInitials("Élodie Ñandú")).toBe("ÉÑ");
    expect(orgInitials("")).toBe("?");
  });
});
