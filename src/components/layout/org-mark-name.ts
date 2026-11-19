import { initialsOf } from "@/components/ui/avatar";

/**
 * Words that say nothing about which organization this is, so they never become its initials: articles and
 * joining words, and labels the platform itself puts on names ("Demo: …", "… (sandbox)").
 */
const FILLER_WORDS: ReadonlySet<string> = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "the", "to", "demo", "sandbox", "test", "synthetic"]);

/** A short label before a colon ("Demo: Lone Star Fund") is a prefix, not part of the name. Longer text is kept. */
const MAX_PREFIX_WORDS = 2;

function words(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => w.length > 0);
}

/**
 * The part of an organization's name its mark is drawn from: no parenthesised or bracketed asides, no short
 * "Label:" prefix, no punctuation-only tokens, no filler words. "Demo: Lone Star Scholarship Fund (sandbox)" →
 * "Lone Star Scholarship Fund". Falls back to the plain words, then to the name itself, so a mark always has text.
 */
export function orgMarkName(name: string): string {
  let text = name.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  const colon = text.indexOf(":");
  if (colon > 0) {
    const before = words(text.slice(0, colon));
    const after = words(text.slice(colon + 1));
    if (before.length <= MAX_PREFIX_WORDS && after.length > 0) text = text.slice(colon + 1);
  }
  const all = words(text);
  const significant = all.filter((w) => !FILLER_WORDS.has(w.toLowerCase()));
  if (significant.length > 0) return significant.join(" ");
  if (all.length > 0) return all.join(" ");
  const plain = words(name);
  return plain.length > 0 ? plain.join(" ") : name.trim();
}

/**
 * The initials an organization's mark shows: first and last significant word ("Demo: Lone Star Fund (sandbox)" →
 * "LF"). People's avatars use the first two words instead (initialsOf); an organization's last word is usually the
 * more telling one ("Fund", "Scholars").
 */
export function orgInitials(name: string): string {
  const marked = orgMarkName(name).split(/\s+/).filter((w) => /\p{L}/u.test(w));
  return marked.length > 1 ? initialsOf(`${marked[0]} ${marked[marked.length - 1]}`) : initialsOf(marked[0] ?? "");
}
