// Extracts the normative statements from a spec's Markdown source.
//
// A normative statement is a sentence that carries an obligation keyword from
// BCP 14 (MUST, SHALL, REQUIRED, SHOULD, RECOMMENDED, and their negations) in
// capitals. MAY and OPTIONAL grant permission rather than impose a requirement,
// so they are not extracted. The CDDL schema is normative too, so each CDDL rule
// is extracted by name.
//
// The registry (`requirements.yaml`) holds every extracted statement,
// word for word, so the traceability test can prove nothing was missed and
// nothing was invented.

const KEYWORD =
  /\b(MUST NOT|MUST|SHALL NOT|SHALL|REQUIRED|SHOULD NOT|SHOULD|NOT RECOMMENDED|RECOMMENDED)\b/;

// Abbreviations whose trailing period does not end a sentence.
const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|cf)\.$/;

export type Strength = "MUST" | "MUST NOT" | "SHOULD" | "SHOULD NOT";

export interface Statement {
  /** The anchor of the section the statement sits in, as the published spec slugs it. */
  section: string;
  /** The section's heading text. */
  heading: string;
  /** The sentence, with whitespace collapsed and list or definition markers removed. */
  text: string;
  strength: Strength;
}

export interface CddlRule {
  section: string;
  name: string;
  /** The rule's definition, as written in the spec. */
  text: string;
}

/** The anchor ReSpec gives a heading. */
export function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function strengthOf(text: string): Strength | undefined {
  const found = new Set(
    [...text.matchAll(new RegExp(KEYWORD.source, "g"))].map((m) => m[1]),
  );
  if (found.has("MUST NOT") || found.has("SHALL NOT")) return "MUST NOT";
  if (found.has("MUST") || found.has("SHALL") || found.has("REQUIRED")) return "MUST";
  if (found.has("SHOULD NOT") || found.has("NOT RECOMMENDED")) return "SHOULD NOT";
  if (found.has("SHOULD") || found.has("RECOMMENDED")) return "SHOULD";
  return undefined;
}

export function normalize(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^(?:[-*]|\d+\.|:)\s+/, "")
    .trim();
}

function sentences(unit: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const part of unit.split(/(?<=[.!?])\s+(?=[A-Z[*`(])/)) {
    current = current ? `${current} ${part}` : part;
    if (!ABBREVIATIONS.test(current)) {
      out.push(current);
      current = "";
    }
  }
  if (current) out.push(current);
  return out;
}

/** Splits a paragraph into units: each list item, and each run of other lines. */
function units(paragraph: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  for (const line of paragraph.split("\n")) {
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line) && current.length > 0) {
      out.push(current.join(" "));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) out.push(current.join(" "));
  return out;
}

export interface Extracted {
  statements: Statement[];
  cddl: CddlRule[];
  /** Each section's prose, whitespace collapsed, for finding a definition's sentence. */
  prose: Map<string, string>;
}

export function extract(markdown: string): Extracted {
  const statements: Statement[] = [];
  const prose = new Map<string, string>();
  const cddl: CddlRule[] = [];
  let heading = "";
  let section = "";
  let top = "";
  let paragraph: string[] = [];
  let fence: string[] | undefined;

  const flush = () => {
    const text = paragraph.join("\n");
    paragraph = [];
    if (!text.trim()) return;
    prose.set(section, `${prose.get(section) ?? ""} ${text.replace(/\s+/g, " ")}`);
    for (const unit of units(text)) {
      for (const sentence of sentences(normalize(unit))) {
        const strength = strengthOf(sentence);
        if (strength) statements.push({ section, heading, text: normalize(sentence), strength });
      }
    }
  };

  for (const line of markdown.split("\n")) {
    if (fence) {
      if (/^\s*```/.test(line)) {
        if (top === "cddl-schema") cddl.push(...cddlRules(fence));
        fence = undefined;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      flush();
      fence = [];
      continue;
    }
    const h = /^(#+)\s+(.*)$/.exec(line);
    if (h) {
      flush();
      heading = h[2]!.trim();
      section = slug(heading);
      if (h[1]!.length === 1) top = section;
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return { statements, cddl, prose };
}

function cddlRules(lines: string[]): CddlRule[] {
  const section = "cddl-schema";
  const rules: CddlRule[] = [];
  let current: CddlRule | undefined;
  for (const line of lines) {
    const m = /^([A-Za-z][\w-]*)\s*=/.exec(line);
    if (m) {
      current = { section, name: m[1]!, text: line };
      rules.push(current);
    } else if (current && line.trim()) {
      current.text += `\n${line}`;
    }
  }
  return rules;
}
