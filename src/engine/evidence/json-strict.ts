import { invalid } from "@/lib/errors";

/**
 * JSON parsing for files whose signature is about to be checked.
 *
 * `JSON.parse` keeps the last of two members with the same name and says nothing. Other tools keep the first,
 * and a person reading the file sees both. A signed file could then show one value to its reader and another
 * to the verifier. This parser accepts exactly what `JSON.parse` accepts, except that an object with a
 * repeated member name is refused.
 */

interface Container {
  /** Member names seen so far in an object; null for an array. */
  names: Set<string> | null;
  path: string;
  /** Position of the element being read, for arrays. */
  index: number;
  /** Name of the member being read, for objects. */
  member: string;
}

function joinPath(path: string, name: string): string {
  return path === "" ? name : `${path}.${name}`;
}

/** Returns the path of the first repeated member name, or null. `text` must already be valid JSON. */
function findDuplicateMember(text: string): string | null {
  const stack: Container[] = [];
  const childPath = (): string => {
    const parent = stack[stack.length - 1];
    if (!parent) return "";
    return parent.names === null ? `${parent.path}[${parent.index}]` : joinPath(parent.path, parent.member);
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "{") {
      stack.push({ names: new Set(), path: childPath(), index: 0, member: "" });
    } else if (char === "[") {
      stack.push({ names: null, path: childPath(), index: 0, member: "" });
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
      // A string is a member name exactly when the next significant character is a colon.
      let next = i + 1;
      while (next < text.length && " \t\n\r".includes(text[next])) next += 1;
      if (top?.names && text[next] === ":") {
        // Decoded, so that "a" and its escaped spelling count as the same name.
        const name = JSON.parse(text.slice(start, i + 1)) as string;
        if (top.names.has(name)) return joinPath(top.path, name);
        top.names.add(name);
        top.member = name;
      }
    }
    i += 1;
  }
  return null;
}

/** Parses JSON text. Throws a `validation_failed` AppError for a syntax error and for a repeated member name. */
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
