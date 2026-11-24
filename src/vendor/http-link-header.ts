// HTTP Link header parsing [RFC 8288], copied from http-link-header so the suite
// carries no dependency for it.
//
//   Source:  https://codeberg.org/jhermsmeier/node-http-link-header, lib/link.js
//   Version: 1.1.4, commit c0e0471787528f86ff86b5778844d585ce892af8
//
// Only the parsing path is copied (`parse` and the helpers it calls), ported from
// CommonJS to TypeScript with the logic and names unchanged. The changes, all
// because the header comes from an untrusted website: each parsed reference is a
// null-prototype object, so an attribute named `__proto__` is an ordinary member;
// and `parseExtendedValue` neither assumes the optional charset and language parts
// are present nor throws on a malformed percent-encoding. `test/vendor-http-link-header.test.ts` carries upstream's parse tests.
//
// The MIT License (MIT)
// Copyright (c) 2016-2026 Jonas Hermsmeier, and contributors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

const COMPATIBLE_ENCODING_PATTERN = /^utf-?8|ascii|utf-?16-?le|ucs-?2|base-?64|latin-?1$/i;
const WS_TRIM_PATTERN = /^[\s﻿\xA0]+|[\s﻿\xA0]+$/g;
const WS_CHAR_PATTERN = /\s|﻿|\xA0/;
const WS_FOLD_PATTERN = /\r?\n[\x20\x09]+/g;
const DELIMITER_PATTERN = /[;,"]/;

const STATE = {
  IDLE: 1 << 0,
  URI: 1 << 1,
  ATTR: 1 << 2,
} as const;

export interface ExtendedValue {
  language: string;
  encoding: string | null;
  value: string;
}

/** A parsed link: its URI, and each attribute as a string, repeated ones as an array. */
export type LinkRef = { uri: string } & Record<string, string | string[] | ExtendedValue>;

function trim(value: string): string {
  return value.replace(WS_TRIM_PATTERN, "");
}

function hasWhitespace(value: string | undefined): boolean {
  return value !== undefined && WS_CHAR_PATTERN.test(value);
}

function skipWhitespace(value: string, offset: number): number {
  while (hasWhitespace(value[offset])) {
    offset++;
  }
  return offset;
}

function newRef(uri: string): LinkRef {
  const ref = Object.create(null) as LinkRef;
  ref.uri = uri;
  return ref;
}

function isCompatibleEncoding(value: string | undefined): boolean {
  return value !== undefined && COMPATIBLE_ENCODING_PATTERN.test(value);
}

function isSingleOccurenceAttr(attr: string): boolean {
  return attr === "rel" || attr === "type" || attr === "media" || attr === "title" || attr === "title*";
}

function expandRelations(ref: LinkRef): LinkRef[] {
  const rels = (ref.rel as string).split(" ");
  return rels.map((rel) => {
    const value = Object.assign(Object.create(null), ref) as LinkRef;
    value.rel = rel;
    return value;
  });
}

/** Parses an extended value (`title*=UTF-8'en'...`) and attempts to decode it. */
function parseExtendedValue(value: string): ExtendedValue {
  const parts = /([^']+)?(?:'([^']*)')?(.+)/.exec(value) ?? [];
  const compatible = isCompatibleEncoding(parts[1]);
  let decoded = parts[3] ?? "";
  if (compatible) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // A malformed percent-encoding is kept as it came.
    }
  }
  return {
    language: (parts[2] ?? "").toLowerCase(),
    encoding: compatible ? null : (parts[1] ?? "").toLowerCase() || null,
    value: decoded,
  };
}

function push(refs: LinkRef[], ref: LinkRef) {
  if (ref.rel != null && typeof ref.rel === "string") refs.push(...expandRelations(ref));
  else refs.push(ref);
}

/** Parses a Link header value into its references. Throws on a malformed header. */
export function parseLinkHeader(input: string): LinkRef[] {
  const refs: LinkRef[] = [];

  // Trim & unfold folded lines
  const value = trim(input).replace(WS_FOLD_PATTERN, "");

  let state: number = STATE.IDLE;
  const length = value.length;
  let offset = 0;
  let ref: LinkRef | null = null;

  while (offset < length) {
    if (state === STATE.IDLE) {
      if (hasWhitespace(value[offset])) {
        offset++;
        continue;
      } else if (value[offset] === "<") {
        if (ref != null) push(refs, ref);
        const end = value.indexOf(">", offset);
        if (end === -1) throw new Error(`Expected end of URI delimiter at offset ${offset}`);
        ref = newRef(value.slice(offset + 1, end));
        offset = end;
        state = STATE.URI;
      } else {
        throw new Error(`Unexpected character "${value[offset]}" at offset ${offset}`);
      }
      offset++;
    } else if (state === STATE.URI) {
      if (hasWhitespace(value[offset])) {
        offset++;
        continue;
      } else if (value[offset] === ";") {
        state = STATE.ATTR;
        offset++;
      } else if (value[offset] === ",") {
        state = STATE.IDLE;
        offset++;
      } else {
        throw new Error(`Unexpected character "${value[offset]}" at offset ${offset}`);
      }
    } else if (state === STATE.ATTR) {
      if (value[offset] === ";" || hasWhitespace(value[offset])) {
        offset++;
        continue;
      }
      let end = value.indexOf("=", offset);
      if (end === -1) end = value.indexOf(";", offset);
      if (end === -1) end = value.length;
      const attr = trim(value.slice(offset, end)).toLowerCase();
      let attrValue = "";
      offset = end + 1;
      offset = skipWhitespace(value, offset);
      if (value[offset] === '"') {
        offset++;
        while (offset < length) {
          if (value[offset] === '"') {
            offset++;
            break;
          }
          if (value[offset] === "\\") {
            offset++;
          }
          attrValue += value[offset] ?? "";
          offset++;
        }
      } else {
        let end = offset + 1;
        while (!DELIMITER_PATTERN.test(value[end] ?? "") && end < length) {
          end++;
        }
        attrValue = value.slice(offset, end);
        offset = end;
      }
      const current = ref![attr];
      if (current && isSingleOccurenceAttr(attr)) {
        // Ignore multiples of attributes which may only appear once
      } else if (attr[attr.length - 1] === "*") {
        ref![attr] = parseExtendedValue(attrValue);
      } else {
        attrValue = attr === "type" ? attrValue.toLowerCase() : attrValue;
        if (current != null) {
          if (Array.isArray(current)) current.push(attrValue);
          else ref![attr] = [current as string, attrValue];
        } else {
          ref![attr] = attrValue;
        }
      }
      switch (value[offset]) {
        case ",":
          state = STATE.IDLE;
          break;
        case ";":
          state = STATE.ATTR;
          break;
      }
      offset++;
    } else {
      throw new Error(`Unknown parser state "${state}"`);
    }
  }

  if (ref != null) push(refs, ref);
  return refs;
}
