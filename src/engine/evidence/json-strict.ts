import { invalid } from "@/lib/errors";

/**
 * JSON parsing for files whose signature is about to be checked.
 *
 * `JSON.parse` keeps the last of two members with the same name and says nothing. Other tools keep the first,
 * and a person reading the file sees both. A signed file could then show one value to its reader and another
 * to the verifier. This parser accepts exactly what `JSON.parse` accepts, except that an object with a
 * repeated member name is refused.
 */

/** Returns the path of the first repeated member name in syntactically valid JSON text, or null. */
function findDuplicateMember(text: string): string | null {
  // One entry per open container: an object's member names so far, or null for an array.
  const stack: Array<{ names: Set<string> | null; path: string; index: number }> = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "{") {
      stack.push({ names: new Set(), path: currentPath(stack), index: 0 });
    } else if (char === "[") {
      stack.push({ names: null, path: currentPath(stack), index: 0 });
    } else if (char === "}" || char === "]") {
      stack.pop();
    } else if (char === ",") {
      const top = stack[stack.length - 1];
      if (top) top.index += 1;
    } else if (char === '"') {
      const start = i;
      i += 1;
      while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      const top = stack[stack.length - 1];
      // A string is a member name when the next significant character is a colon.
      let next = i + 1;
      while (next < text.length && " \t\n\r".includes(text[next])) next += 1;
      if (top?.names && text[next] === ":") {
        const name = JSON.parse(text.slice(start, i + 1)) as string;
        if (top.names.has(name)) return `${top.path}${top.path === "" ? "" : "."}${name}`;
        top.names.add(name);
        top.lastName = name;
      }
    }
    i += 1;
  }
  return null;

  function currentPath(containers: typeof stack): string {
    const parent = containers[containers.length - 1];
    if (!parent) return "";
    if (parent.names === null) return `${parent.path}[${parent.index}]`;
    return `${parent.path}${parent.path === "" ? "" : "."}${parent.lastName ?? ""}`;
  }
}

declare module "./json-strict" {
  // Marker so the container type above can carry the name of the member being read.
}

/** Parses JSON text. Throws a `bad_request` AppError for a syntax error and for a repeated member name. */
export function parseJsonStrict(text: string): unknown {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw invalid(`Not valid JSON: ${error instanceof Error ? error.message : "syntax error"}`, { reason: "invalid_json" });
  }
  const duplicate = findDuplicateMember(source);
  if (duplicate !== null) {
    throw invalid(`The JSON repeats the member name "${duplicate}". A signed file must not say one thing twice.`, { reason: "duplicate_member", path: duplicate });
  }
  return value;
}
