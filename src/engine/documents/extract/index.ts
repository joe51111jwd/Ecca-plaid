/**
 * Dispatches a classified document to its extractor.
 */
import type { Classification } from "../classify";
import { documentTextFromString, stripSyntheticBanner, type DocumentText } from "../text";
import { PARSER_VERSION, type DocumentReaderPolicy, type DocumentSubtype, type Extraction } from "../types";
import { defaultContext, ExtractionBuilder, type ExtractContext } from "./common";
import { extractForm1040 } from "./form1040";
import { extractPayStub } from "./pay-stub";
import { extractSection8 } from "./section8";
import { extractSimpleNotice, extractUnemploymentNotice } from "./simple-notices";
import { extractBenefitVerificationLetter, extractSsaNotice } from "./ssa";
import { extractTf0001 } from "./tf0001";
import { extractOtherTranscript, extractTaxReturnTranscript } from "./transcripts";
import { extractW2 } from "./w2";
import { extractWic } from "./wic";

function unknown(ctx: ExtractContext): Extraction {
  const b = new ExtractionBuilder("unknown", ctx.policy);
  b.review("unknown_document", "The document is not one of the types the reader recognises; a person must look at it.");
  return b.build(null, null);
}

const EXTRACTORS: Readonly<Record<DocumentSubtype, (ctx: ExtractContext) => Extraction>> = {
  tx_hhsc_tf0001: extractTf0001,
  tx_hhsc_h1009: (c) => extractSimpleNotice(c, "tx_hhsc_h1009"),
  tx_hhsc_h1017: (c) => extractSimpleNotice(c, "tx_hhsc_h1017"),
  tx_hhsc_h1020: (c) => extractSimpleNotice(c, "tx_hhsc_h1020"),
  tx_hhsc_h1718: (c) => extractSimpleNotice(c, "tx_hhsc_h1718"),
  tx_hhsc_renewal: (c) => extractSimpleNotice(c, "tx_hhsc_renewal"),
  tx_hhsc_other: (c) => extractSimpleNotice(c, "tx_hhsc_other"),
  benefit_card: (c) => extractSimpleNotice(c, "benefit_card"),
  school_meals_notice: (c) => extractSimpleNotice(c, "school_meals_notice"),
  unemployment_notice: extractUnemploymentNotice,
  wic_certification: (c) => extractWic(c, "wic_certification"),
  wic_ineligible: (c) => extractWic(c, "wic_ineligible"),
  wic_benefit_list: (c) => extractWic(c, "wic_benefit_list"),
  hcv_voucher: (c) => extractSection8(c, "hcv_voucher"),
  hud_hap_contract: (c) => extractSection8(c, "hud_hap_contract"),
  hud_50058: (c) => extractSection8(c, "hud_50058"),
  pha_notice: (c) => extractSection8(c, "pha_notice"),
  ssa_benefit_verification: extractBenefitVerificationLetter,
  ssa_ssi_notice: (c) => extractSsaNotice(c, "ssa_ssi_notice"),
  ssa_title2_notice: (c) => extractSsaNotice(c, "ssa_title2_notice"),
  ssa_other: (c) => extractSsaNotice(c, "ssa_other"),
  irs_w2: (c) => extractW2(c, "irs_w2"),
  irs_w2c: (c) => extractW2(c, "irs_w2c"),
  form_1040: (c) => extractForm1040(c, "form_1040"),
  form_1040_variant: (c) => extractForm1040(c, "form_1040_variant"),
  irs_tax_return_transcript: extractTaxReturnTranscript,
  irs_wage_income_transcript: (c) => extractOtherTranscript(c, "irs_wage_income_transcript"),
  irs_record_of_account: (c) => extractOtherTranscript(c, "irs_record_of_account"),
  irs_account_transcript: (c) => extractOtherTranscript(c, "irs_account_transcript"),
  irs_verification_of_nonfiling: (c) => extractOtherTranscript(c, "irs_verification_of_nonfiling"),
  pay_stub: extractPayStub,
  unknown,
};

/**
 * Runs the extractor for `subtype` (or the classification's subtype) on the text. Deterministic; never
 * throws on document content. The synthetic-fixture banner is removed first so it is never read as data.
 */
export function extractDocument(
  input: string | DocumentText,
  subtype: DocumentSubtype | Classification,
  policy?: Partial<DocumentReaderPolicy>,
): Extraction {
  const doc = stripSyntheticBanner(typeof input === "string" ? documentTextFromString(input) : input);
  const target = typeof subtype === "string" ? subtype : subtype.subtype;
  const ctx = defaultContext(doc, policy);
  try {
    return EXTRACTORS[target](ctx);
  } catch (e) {
    // A defect in an extractor must not become a silent yes or an escaped exception: send it to review.
    const b = new ExtractionBuilder(target, ctx.policy);
    b.review("unreadable_file", "The reader failed on this document; a person must read it.");
    b.signal(`extractor error: ${e instanceof Error ? e.name : "unknown"}`);
    return { ...b.build(null, null), parserVersion: PARSER_VERSION };
  }
}
