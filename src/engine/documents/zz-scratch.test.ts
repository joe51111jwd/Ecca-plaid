import { it } from "vitest";
import { generateSyntheticDocument } from "./synthetic";
import { readDocument, extractPdfText } from "./index";
it("scratch", async () => {
  const bytes = await generateSyntheticDocument("tf0001", {
    noticeDate: "2026-09-15", caseNumber: "9990000001", addressee: "DANA SAMPLE",
    sections: [{ heading: "SNAP Food Benefits", tables: [{ status: "gets", subject: "SNAP food benefits", rows: [
      { name: "DANA SAMPLE", edg: "990000011", program: "SNAP", start: "2026-09-01", end: "2027-02-28" },
      { name: "RILEY SAMPLE", edg: "990000011", program: "SNAP", start: "2026-09-01", end: "2027-02-28" }] }], notes: "Monthly amount: $600.00" }],
  });
  const t = await extractPdfText(bytes);
  console.log(t.pages[0].lines.map((l) => `${l.y.toFixed(0)} | ${l.text}`).join("\n"));
  const r = await readDocument({ bytes, contentType: "application/pdf", declaredKind: "award_letter", referenceDate: "2026-12-01",
    household: [{ id: "a", firstName: "Dana", lastName: "Sample" }, { id: "b", firstName: "Riley", lastName: "Sample" }] });
  console.log(JSON.stringify({ ...r, classification: r.classification, extraction: { ...r.extraction, fields: Object.fromEntries(Object.entries(r.extraction!.fields).map(([k, v]) => [k, `${v.value} @${v.confidence} p${v.page} ${v.snippet}`])) } }, null, 1));
});
