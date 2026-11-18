import { createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { publicJwk } from "@/lib/crypto";
import type { EvidenceJwks } from "./types";

/**
 * Helpers for tests that exercise evidence packs: throwaway signing keys and reading a PDF's text back.
 * Not part of the engine's public entry point; import it from tests only.
 */

export interface TestSigningKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

/** A fresh Ed25519 key pair. Never use one of these outside a test. */
export function generateTestSigningKey(kid = "test-evidence-key"): TestSigningKey {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { kid, privateKey, publicKey: createPublicKey(privateKey) };
}

export function jwksOf(...keys: TestSigningKey[]): EvidenceJwks {
  return { keys: keys.map((key) => publicJwk(key)) };
}

export interface ExtractedPdf {
  /** Text of each page, its text runs joined by single spaces. */
  pages: string[];
  /** All pages joined by a space. */
  text: string;
  /** The same text with every white-space character removed, for values that wrap across lines (hashes, long ids). */
  compact: string;
  /** The document information dictionary (Title, Author, Subject, Keywords, Producer, Creator, CreationDate, ModDate, Language). */
  info: Record<string, unknown>;
}

/** Reads a PDF's text and metadata back with pdf.js, the way a reader application would. */
export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdf> {
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false, verbosity: 0 });
  try {
    const document = await task.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const runs = content.items.map((item) => ("str" in item ? item.str : "")).filter((run) => run.trim() !== "");
      pages.push(runs.join(" ").replace(/\s+/g, " ").trim());
    }
    const metadata = await document.getMetadata();
    const text = pages.join(" ");
    return { pages, text, compact: text.replace(/\s+/g, ""), info: metadata.info as Record<string, unknown> };
  } finally {
    await task.destroy();
  }
}
