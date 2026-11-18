/**
 * Document reading service: the engine's parser, plus optional model-assisted reading of scans and photos.
 *
 *   readUploadedDocument({ bytes, contentType, declaredKind, referenceDate?, household? })
 *
 * Environment decides two things and nothing else:
 *  - production rejects synthetic fixtures (`syntheticPolicy: "reject"`, reference P0 step 3);
 *  - ANTHROPIC_API_KEY enables model reading for documents with no text layer. Without it nothing is sent.
 * A model reading is always `needs_review` (MODEL_READ_REQUIRES_HUMAN_CONFIRMATION).
 */
import { readDocument, type DocumentReadResult, type ReadDocumentInput } from "@/engine/documents";
import { env, isProd } from "@/lib/env";
import { readWithModel, type ModelReadableFileType, type ModelReaderClient, type ModelReadResult } from "./model-reader";

export interface UploadedDocumentReading extends Omit<DocumentReadResult, "extractedBy"> {
  extractedBy: "parser" | "model" | null;
  /** Present when the model read the document: which model and prompt version. */
  model: { id: string; readerVersion: string } | null;
}

const MODEL_READABLE: ReadonlySet<string> = new Set<ModelReadableFileType>(["pdf", "jpeg", "png", "webp"]);

export interface ReadUploadedDocumentOptions {
  /** Tests inject a fake client; production builds one from ANTHROPIC_API_KEY. */
  modelClient?: ModelReaderClient;
}

function merge(parser: DocumentReadResult, model: ModelReadResult): UploadedDocumentReading {
  const reasons = [...parser.reviewReasons];
  for (const r of model.reviewReasons) if (!reasons.some((x) => x.code === r.code)) reasons.push(r);
  return {
    ...parser,
    status: "needs_review",
    detectedKind: model.detectedKind,
    extraction: model.extraction,
    reviewReasons: reasons,
    extractedBy: "model",
    model: { id: model.model, readerVersion: model.modelReaderVersion },
  };
}

export async function readUploadedDocument(input: ReadDocumentInput, opts: ReadUploadedDocumentOptions = {}): Promise<UploadedDocumentReading> {
  const parser = await readDocument({
    ...input,
    policy: { ...input.policy, syntheticPolicy: isProd() ? "reject" : (input.policy?.syntheticPolicy ?? "tag") },
  });
  const base: UploadedDocumentReading = { ...parser, model: null };
  const noText = parser.reviewReasons.some((r) => r.code === "no_text_layer");
  if (!noText || !MODEL_READABLE.has(parser.fileType)) return base;

  const model = await readWithModel(
    { bytes: input.bytes, fileType: parser.fileType as ModelReadableFileType, declaredKind: input.declaredKind ?? null },
    { client: opts.modelClient, apiKey: env().ANTHROPIC_API_KEY ?? null },
  );
  return model ? merge(parser, model) : base;
}

export {
  DOCUMENT_READER_MODEL,
  MODEL_READ_REQUIRES_HUMAN_CONFIRMATION,
  MODEL_READER_VERSION,
  modelReadingAvailable,
  readWithModel,
} from "./model-reader";
export type { ModelReaderClient, ModelReadResult, ModelReadInput } from "./model-reader";
