// What a signature's form shows without verifying it: the stored JWS shape, the
// protected header, and, under the `did:web` profile, the signer and key ID.
// Verifying a signature (resolving the DID, checking the bytes) is pending.

import { pointer } from "../json.ts";
import type { DocumentCheck, JsonObject, Outcome, Violation } from "./types.ts";
import { type At, isObject, manifests } from "./walk.ts";

interface Signed {
  sig: At<JsonObject>;
  /** The `typ` the containing object requires. */
  typ: string;
}

interface Decoded extends Signed {
  header: JsonObject;
  signature: Uint8Array;
}

const SEGMENT = /^[A-Za-z0-9_-]+$/;

function signed(catalog: JsonObject): Signed[] {
  const out: Signed[] = [];
  if (isObject(catalog.signature)) out.push({ sig: { value: catalog.signature, at: "/signature" }, typ: "ai-catalog+jws" });
  for (const m of manifests(catalog)) {
    if (isObject(m.value.signature)) {
      out.push({ sig: { value: m.value.signature, at: pointer(m.at, "signature") }, typ: "ai-catalog-trust-manifest+jws" });
    }
  }
  return out;
}

/** base64url's bytes, or undefined unless it is the one canonical encoding of them. */
function base64url(segment: string): Uint8Array | undefined {
  if (!SEGMENT.test(segment)) return undefined;
  const bytes = Buffer.from(segment, "base64url");
  return bytes.toString("base64url") === segment ? new Uint8Array(bytes) : undefined;
}

/** Why a `jws` value is not `header..signature`, or its parts. */
function decode(jws: string): { header: JsonObject; signature: Uint8Array } | string {
  const parts = jws.split(".");
  if (parts.length !== 3 || parts[1] !== "") return "is not of the form encodedProtectedHeader..encodedSignature";
  const header = base64url(parts[0]!);
  const signature = base64url(parts[2]!);
  if (!header) return "has a protected header that is not canonical base64url";
  if (!signature) return "has a signature that is not canonical base64url";
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(header)) as unknown;
    if (!isObject(value as never)) return "has a protected header that is not a JSON object";
    return { header: value as JsonObject, signature };
  } catch {
    return "has a protected header that is not JSON";
  }
}

function decoded(catalog: JsonObject, didWebOnly = false): Decoded[] {
  return signed(catalog).flatMap((s) => {
    if (typeof s.sig.value.jws !== "string") return [];
    if (didWebOnly && s.sig.value.profile !== "did-web-v1") return [];
    const d = decode(s.sig.value.jws);
    return typeof d === "string" ? [] : [{ ...s, ...d }];
  });
}

const jwsAt = (s: Signed) => pointer(s.sig.at, "jws");
const over = (items: Decoded[], each: (d: Decoded) => Violation[]): Outcome =>
  items.length === 0 ? "n/a" : items.flatMap(each);

/** `did:web:{domain}` with no path; the domain, or undefined. */
function rootDidWebDomain(signer: string): string | undefined {
  const m = /^did:web:([^:#?/]+)$/.exec(signer);
  return m?.[1];
}

const LOWERCASE_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export const signatureChecks: Record<string, DocumentCheck> = {
  "SIG-5": ({ catalog }) => {
    const list = signed(catalog).filter((s) => typeof s.sig.value.jws === "string");
    if (list.length === 0) return "n/a";
    return list.flatMap((s) => {
      const d = decode(s.sig.value.jws as string);
      return typeof d === "string" ? [{ at: jwsAt(s), message: `\`jws\` ${d}` }] : [];
    });
  },

  "JWS-5": ({ catalog }) =>
    over(decoded(catalog), (d) =>
      ["alg", "typ"]
        .filter((k) => !Object.hasOwn(d.header, k))
        .map((k) => ({ at: jwsAt(d), message: `the protected header has no \`${k}\`` })),
    ),

  "JWS-6": ({ catalog }) =>
    over(
      decoded(catalog).filter((d) => Object.hasOwn(d.header, "typ")),
      (d) =>
        d.header.typ === d.typ
          ? []
          : [{ at: jwsAt(d), message: `the protected \`typ\` is "${d.header.typ}"; this object's signature needs "${d.typ}"` }],
    ),

  "JWS-8": ({ catalog }) =>
    over(decoded(catalog), (d) =>
      d.header.alg === "none" ? [{ at: jwsAt(d), message: "the protected `alg` is `none`" }] : [],
    ),

  "JWS-9": ({ catalog }) =>
    over(decoded(catalog), (d) =>
      Object.hasOwn(d.header, "b64") ? [{ at: jwsAt(d), message: "the protected header has `b64`" }] : [],
    ),

  "DIDWEB-1": ({ catalog }) =>
    over(decoded(catalog, true), (d) => {
      const signer = d.sig.value.signer;
      return typeof signer === "string" && rootDidWebDomain(signer) !== undefined
        ? []
        : [{ at: pointer(d.sig.at, "signer"), message: `"${String(signer)}" is not a root did:web DID` }];
    }),

  "DIDWEB-2": ({ catalog }) =>
    over(decoded(catalog, true), (d) => {
      const signer = d.sig.value.signer;
      const domain = typeof signer === "string" ? rootDidWebDomain(signer) : undefined;
      if (domain === undefined) return []; // DIDWEB-1 reports it
      const why = domain.includes("%3A")
        ? "has a port"
        : domain.endsWith(".")
          ? "ends in a root dot"
          : IPV4.test(domain)
            ? "is an IP address"
            : !LOWERCASE_DOMAIN.test(domain)
              ? "is not a lowercase ASCII domain name"
              : undefined;
      return why ? [{ at: pointer(d.sig.at, "signer"), message: `the domain "${domain}" ${why}` }] : [];
    }),

  "DIDALG-1": ({ catalog }) =>
    over(decoded(catalog, true), (d) => {
      if (d.header.alg !== "ES256") return [{ at: jwsAt(d), message: `the protected \`alg\` is "${String(d.header.alg)}", not ES256` }];
      return d.signature.length === 64
        ? []
        : [{ at: jwsAt(d), message: `the signature is ${d.signature.length} bytes; an ES256 signature is 64` }];
    }),

  "DIDALG-3": ({ catalog }) =>
    over(decoded(catalog, true), (d) =>
      Object.hasOwn(d.header, "kid") ? [] : [{ at: jwsAt(d), message: "the protected header has no `kid`" }],
    ),

  "DIDALG-4": ({ catalog }) =>
    over(decoded(catalog, true), (d) =>
      ["jku", "jwk", "x5u", "x5c"]
        .filter((k) => Object.hasOwn(d.header, k))
        .map((k) => ({ at: jwsAt(d), message: `the protected header has \`${k}\`` })),
    ),

  "DIDALG-5": ({ catalog }) =>
    over(
      decoded(catalog, true).filter((d) => Object.hasOwn(d.header, "kid")),
      (d) => {
        const kid = d.header.kid;
        const signer = d.sig.value.signer;
        const ok = typeof kid === "string" && typeof signer === "string" && kid.startsWith(`${signer}#`) && kid.length > signer.length + 1;
        return ok ? [] : [{ at: jwsAt(d), message: `the protected \`kid\` "${String(kid)}" is not the signer followed by #fragment` }];
      },
    ),
};
