import type { Json, Parsed } from "../json.ts";

export type JsonObject = { [key: string]: Json };

export interface Violation {
  /** JSON Pointer to the offending value. */
  at: string;
  message: string;
  /** Report as a notice whatever the requirement's strength (ENTRY-6). */
  notice?: boolean;
}

/** A check's outcome: its violations (none means it passed), or "n/a". */
export type Outcome = Violation[] | "n/a";

export interface DocumentContext {
  catalog: JsonObject;
  parsed: Parsed;
  /** The spec version the registry covers. */
  specVersion: string;
}

export interface Fetched {
  url: string;
  status: number;
  /** The media type, lowercased, without parameters. */
  mediaType: string | undefined;
  /** The response's `Link` header, for discovery. */
  link?: string;
  bytes: Uint8Array;
}

export interface FetchContext extends DocumentContext {
  /** Where the catalog was fetched from, when it was. */
  catalogUrl?: string;
  /** The catalog's own response, when it was fetched. */
  catalogResponse?: Fetched;
  fetch(url: string): Promise<Fetched>;
}

export type DocumentCheck = (ctx: DocumentContext) => Outcome;
export type FetchCheck = (ctx: FetchContext) => Promise<Outcome>;
