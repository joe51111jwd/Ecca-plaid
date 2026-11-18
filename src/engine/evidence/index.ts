/**
 * Evidence pack: the signed JSON record and the PDF an SGO hands an auditor for one verification.
 *
 *   const record = buildEvidenceRecord(input);            // validates, minimizes, writes the sentences
 *   const signed = signEvidenceRecord(record, key);        // Ed25519 over the canonical bytes
 *   const pdf = await renderEvidencePdf(signed, { verifyUrl, brand });
 *   verifySignedEvidence(signed, jwks)                     // { valid, reason?, kid }
 *
 * The functions in record.ts and pdf.ts are pure: no database, network, file system, environment or clock.
 * `platform.ts` adds wrappers that use this deployment's signing key.
 */
export { EVIDENCE_COPY_VERSION } from "./copy";
export { formatUtcTimestamp, groupHash } from "./format";
export { parseJsonStrict } from "./json-strict";
export { EVIDENCE_PDF_RENDERER, renderEvidencePdf } from "./pdf";
export { buildSignedEvidence, platformJwks, signEvidenceRecordWithPlatformKey, verifySignedEvidenceWithPlatformKey } from "./platform";
export { EVIDENCE_POLICY } from "./policy";
export {
  buildEvidenceRecord,
  canonicalRecordBytes,
  signEvidenceRecord,
  verifySignedEvidence,
  /** The name docs/architecture.md uses for the same function. */
  verifySignedEvidence as verifyEvidenceRecord,
  type EvidenceInputErrorDetails,
  type EvidenceIssue,
  type EvidenceIssueCode,
  type EvidenceVerificationKeys,
} from "./record";
export {
  EVIDENCE_CANONICALIZATION,
  EVIDENCE_JWKS_PATH,
  EVIDENCE_RECORD_TYPE,
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_SIGNATURE_ALG,
  type EvidenceActorInput,
  type EvidenceActorType,
  type EvidenceApprovalStatus,
  type EvidenceCategoricalInput,
  type EvidenceConsentInput,
  type EvidenceCountyResolution,
  type EvidenceCustodyInput,
  type EvidenceDecidedByInput,
  type EvidenceDecisionInput,
  type EvidenceDocumentInput,
  type EvidenceDocumentKind,
  type EvidenceExtractedFieldInput,
  type EvidenceExtractor,
  type EvidenceGeographyInput,
  type EvidenceHouseholdInput,
  type EvidenceHouseholdMemberInput,
  type EvidenceIncomeInput,
  type EvidenceIncomeItemInput,
  type EvidenceIncomeSource,
  type EvidenceIncomeTreatment,
  type EvidenceInput,
  type EvidenceJwk,
  type EvidenceJwks,
  type EvidenceMemberRole,
  type EvidenceMethod,
  type EvidenceMethodBasis,
  type EvidenceMode,
  type EvidencePdfOptions,
  type EvidenceProgram,
  type EvidencePublicKey,
  type EvidenceRailInput,
  type EvidenceRailKind,
  type EvidenceReason,
  type EvidenceRecord,
  type EvidenceRecordActor,
  type EvidenceRecordConsent,
  type EvidenceRecordDocument,
  type EvidenceRecordExtractedField,
  type EvidenceRecordIncomeItem,
  type EvidenceRecordRail,
  type EvidenceReliedOn,
  type EvidenceReviewEntryInput,
  type EvidenceScopeValue,
  type EvidenceSignature,
  type EvidenceSigningKey,
  type EvidenceStatus,
  type EvidenceThresholdInput,
  type EvidenceThresholdLabelInput,
  type EvidenceThresholdReadingInput,
  type EvidenceThresholdSource,
  type EvidenceTimelineEntryInput,
  type EvidenceVerification,
  type EvidenceVerifyFailure,
  type EvidenceVersionsInput,
  type SignedEvidence,
  type TimestampInput,
} from "./types";
