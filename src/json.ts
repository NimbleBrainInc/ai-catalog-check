// A JSON parser that keeps what `JSON.parse` throws away: the line each value
// starts on, member names that repeat within an object, numbers an IEEE 754
// double cannot hold exactly, and strings with lone surrogates. ENTRY-18 needs
// the last three; reports need the lines.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Parsed {
  value: Json;
  /** The line (1-based) each value starts on, keyed by JSON Pointer. */
  lines: Map<string, number>;
  /** Pointers to members whose name already appeared in the same object. */
  duplicates: string[];
  /** Pointers to numbers beyond a double's range, or integer-valued beyond ±(2^53 - 1), in any spelling. */
  unsafeNumbers: string[];
  /** Pointers to strings (or member names) holding a lone surrogate. */
  loneSurrogates: string[];
}

export class JsonSyntaxError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`${message} (line ${line})`);
    this.line = line;
  }
}

export function pointer(parent: string, key: string | number): string {
  return `${parent}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function parseJson(text: string): Parsed {
  let i = 0;
  let line = 1;
  const lines = new Map<string, number>();
  const duplicates: string[] = [];
  const unsafeNumbers: string[] = [];
  const loneSurrogates: string[] = [];

  const fail = (message: string): never => {
    throw new JsonSyntaxError(message, line);
  };

  const space = () => {
    while (i < text.length) {
      const ch = text[i];
      if (ch === "\n") line++;
      else if (ch !== " " && ch !== "\t" && ch !== "\r") return;
      i++;
    }
  };

  const string = (at: string): string => {
    const start = i;
    i++; // opening quote
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") i++;
      else if (text[i] === "\n") fail("unescaped newline in string");
      i++;
    }
    if (i >= text.length) fail("unterminated string");
    i++;
    const value = JSON.parse(text.slice(start, i)) as string;
    if (LONE_SURROGATE.test(value)) loneSurrogates.push(at);
    return value;
  };

  const value = (at: string): Json => {
    space();
    lines.set(at, line);
    const ch = text[i];
    if (ch === "{") {
      i++;
      const out: { [key: string]: Json } = {};
      const seen = new Set<string>();
      space();
      if (text[i] === "}") {
        i++;
        return out;
      }
      for (;;) {
        space();
        if (text[i] !== '"') fail("expected a member name");
        const key = string(at);
        const child = pointer(at, key);
        if (seen.has(key)) duplicates.push(child);
        seen.add(key);
        space();
        if (text[i] !== ":") fail("expected ':'");
        i++;
        // A defined property, not assignment: `out["__proto__"] = …` would set the
        // object's prototype instead of creating the member.
        Object.defineProperty(out, key, { value: value(child), enumerable: true, writable: true, configurable: true });
        space();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return out;
        }
        fail("expected ',' or '}'");
      }
    }
    if (ch === "[") {
      i++;
      const out: Json[] = [];
      space();
      if (text[i] === "]") {
        i++;
        return out;
      }
      for (;;) {
        out.push(value(pointer(at, out.length)));
        space();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return out;
        }
        fail("expected ',' or ']'");
      }
    }
    if (ch === '"') return string(at);
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i, i + 400));
    if (!literal) return fail("unexpected character");
    i += literal[0].length;
    const raw = literal[0];
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n))) unsafeNumbers.push(at);
    return n;
  };

  const parsed = value("");
  space();
  if (i < text.length) fail("unexpected content after the document");
  return { value: parsed, lines, duplicates, unsafeNumbers, loneSurrogates };
}

/** The line of the value at `at`, or of its nearest ancestor that has one. */
export function lineOf(lines: Map<string, number>, at: string): number | undefined {
  let p = at;
  for (;;) {
    const found = lines.get(p);
    if (found !== undefined) return found;
    if (p === "") return undefined;
    p = p.slice(0, p.lastIndexOf("/"));
  }
}
