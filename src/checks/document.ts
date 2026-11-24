// Checks that need only the catalog document, keyed by requirement ID.

import { type Json, pointer } from "../json.ts";
import type { Kind, SpecFacts } from "../spec-facts.ts";
import type { DocumentCheck, JsonObject, Outcome, Violation } from "./types.ts";
import {
  ABSOLUTE_URI,
  type At,
  DOMAIN,
  entries,
  extensionMaps,
  has,
  isObject,
  manifests,
  member,
  objectsIn,
  isRfc3339,
  SEMVER,
  signatures,
  urnAir,
} from "./walk.ts";

const POLICY_URLS = "https://ai-catalog.org/extensions/policy-urls";

/** The violations, or "n/a" when there was nothing to look at. */
function over<T>(items: T[], each: (item: T) => Violation[]): Outcome {
  if (items.length === 0) return "n/a";
  return items.flatMap(each);
}

function requireMembers(item: At<JsonObject>, what: string, keys: string[]): Violation[] {
  return keys
    .filter((k) => !has(item.value, k))
    .map((k) => ({ at: item.at, message: `${what} has no \`${k}\`` }));
}

const str = (v: Json | undefined): v is string => typeof v === "string";

function identifiers(catalog: JsonObject) {
  return entries(catalog).filter((e) => str(e.value.identifier));
}

// --- CDDL types -------------------------------------------------------------
// The members and types come from the spec's CDDL (spec-facts.ts), not from here.

function typeOk(v: Json, kind: Kind): boolean {
  switch (kind) {
    case "any":
      return true;
    case "text":
      return typeof v === "string";
    case "map":
      return isObject(v);
    case "text[]":
      return Array.isArray(v) && v.every((x) => typeof x === "string");
    case "map[]":
      return Array.isArray(v) && v.every((x) => isObject(x));
    case "tdate":
      return typeof v === "string" && isRfc3339(v);
    case "uint":
      return typeof v === "number" && Number.isInteger(v) && v >= 0;
  }
}

const KIND_NAMES: Record<Kind, string> = {
  any: "any value",
  text: "a string",
  map: "an object",
  "text[]": "an array of strings",
  "map[]": "an array of objects",
  tdate: "an RFC 3339 date-time",
  uint: "a non-negative integer",
};

function rule(facts: SpecFacts, name: string) {
  const r = facts.cddl[name];
  if (!r) throw new Error(`the spec's CDDL has no rule ${name}`);
  return r;
}

function cddl(facts: SpecFacts, name: string, items: At<JsonObject>[]): Outcome {
  const { members } = rule(facts, name);
  return over(items, (item) =>
    Object.entries(members)
      .filter(([key, kind]) => has(item.value, key) && !typeOk(item.value[key] as Json, kind))
      .map(([key, kind]) => ({ at: pointer(item.at, key), message: `\`${key}\` must be ${KIND_NAMES[kind]} (${name})` })),
  );
}

const root = (catalog: JsonObject): At<JsonObject> => ({ value: catalog, at: "" });
const hostOf = (catalog: JsonObject) => member(root(catalog), "host");
const subjects = (catalog: JsonObject) =>
  manifests(catalog).flatMap((m) => {
    const s = member(m, "subject");
    return s ? [{ ...s, manifest: m }] : [];
  });

/** Every digest in the catalog: entries', subjects', attestations', provenance links'. */
function digests(catalog: JsonObject): At<string>[] {
  const out: At<string>[] = [];
  const add = (parent: At<JsonObject>, key: string) => {
    const v = parent.value[key];
    if (str(v)) out.push({ value: v, at: pointer(parent.at, key) });
  };
  for (const e of entries(catalog)) add(e, "digest");
  for (const m of manifests(catalog)) {
    const s = member(m, "subject");
    if (s) add(s, "digest");
    for (const a of objectsIn(m, "attestations")) add(a, "digest");
    for (const p of objectsIn(m, "provenance")) add(p, "sourceDigest");
  }
  return out;
}

const DIGEST_HEX_LENGTH: Record<string, number> = {
  sha256: 64,
  sha384: 96,
  sha512: 128,
  "sha3-256": 64,
  "sha3-384": 96,
  "sha3-512": 128,
};
const WEAK_DIGESTS = new Set(["md5", "sha1", "sha-1", "sha224", "sha-224"]);

const REVERSE_DNS = /^[a-z][a-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;

function isUrl(key: string): boolean {
  try {
    new URL(key);
    return ABSOLUTE_URI.test(key);
  } catch {
    return false;
  }
}

/** A manifest that carries no claim: none of the members VALID-1 lists, or each one empty. */
function carriesClaim(m: JsonObject): boolean {
  const nonEmptyArray = (v: Json | undefined) => Array.isArray(v) && v.length > 0;
  return (
    has(m, "signature") ||
    has(m, "trustSchema") ||
    nonEmptyArray(m.attestations) ||
    nonEmptyArray(m.provenance) ||
    (isObject(m.extensions) && Object.keys(m.extensions).length > 0)
  );
}

export const documentChecks: Record<string, DocumentCheck> = {
  "TOP-1": ({ catalog }) =>
    requireMembers(root(catalog), "The catalog", ["specVersion", "entries"]),

  "TOP-2": ({ catalog }) =>
    has(catalog, "additionalSignatures")
      ? [{ at: "/additionalSignatures", message: "`additionalSignatures` is reserved; producers should omit it" }]
      : [],

  "HOST-1": ({ catalog }) => {
    const host = hostOf(catalog);
    return host ? requireMembers(host, "`host`", ["displayName"]) : "n/a";
  },

  "ENTRY-1": ({ catalog }) =>
    over(entries(catalog), (e) => requireMembers(e, `Entry ${e.index}`, ["identifier", "type"])),

  "ENTRY-3": ({ catalog }) =>
    over(identifiers(catalog), (e) =>
      ABSOLUTE_URI.test(e.value.identifier as string)
        ? []
        : [{ at: pointer(e.at, "identifier"), message: `"${e.value.identifier}" is not an absolute URI` }],
    ),

  "ENTRY-4": ({ catalog }) =>
    over(identifiers(catalog), (e) => {
      const id = e.value.identifier as string;
      const at = pointer(e.at, "identifier");
      if (!id.startsWith("urn:air:")) return [{ at, message: `"${id}" is not a \`urn:air\` identifier` }];
      const urn = urnAir(id);
      if (!urn) return [{ at, message: `"${id}" is not of the form urn:air:{publisher}:{name}[:{kind}]` }];
      if (!DOMAIN.test(urn.publisher)) {
        return [{ at, message: `"${urn.publisher}", the {publisher} segment of "${id}", is not a domain name` }];
      }
      return [];
    }),

  "ENTRY-6": ({ catalog, facts }) =>
    over(
      entries(catalog).filter((e) => str(e.value.type)),
      (e) =>
        facts.knownTypes.has(e.value.type as string)
          ? []
          : [
              {
                at: pointer(e.at, "type"),
                message: `"${e.value.type}" is not one of the spec's known types; fine when none applies`,
                notice: true,
              },
            ],
    ),

  "ENTRY-7": ({ catalog }) =>
    over(entries(catalog), (e) => {
      const n = Number(has(e.value, "url")) + Number(has(e.value, "data"));
      if (n === 1) return [];
      return [{ at: e.at, message: n === 0 ? `Entry ${e.index} has neither \`url\` nor \`data\`` : `Entry ${e.index} has both \`url\` and \`data\`` }];
    }),

  "ENTRY-14": ({ catalog }) =>
    over(
      entries(catalog).filter((e) => str(e.value.version)),
      (e) =>
        SEMVER.test(e.value.version as string)
          ? []
          : [{ at: pointer(e.at, "version"), message: `"${e.value.version}" is not a Semantic Version` }],
    ),

  "ENTRY-16": ({ catalog }) => {
    const byId = groupByIdentifier(catalog);
    const repeated = [...byId.values()].filter((g) => g.length > 1).flat();
    return over(repeated, (e) =>
      has(e.value, "version")
        ? []
        : [{ at: e.at, message: `"${e.value.identifier}" is listed more than once, and entry ${e.index} has no \`version\`` }],
    );
  },

  "ENTRY-18": ({ catalog, parsed }) =>
    over(
      entries(catalog).filter((e) => has(e.value, "data")),
      (e) => {
        const inData = (p: string) => p === `${e.at}/data` || p.startsWith(`${e.at}/data/`);
        return [
          ...parsed.duplicates.filter(inData).map((at) => ({ at, message: "this member name repeats in its object" })),
          ...parsed.unsafeNumbers
            .filter(inData)
            .map((at) => ({ at, message: "this number is beyond what an IEEE 754 double holds exactly" })),
          ...parsed.loneSurrogates.filter(inData).map((at) => ({ at, message: "this string has a lone surrogate" })),
        ];
      },
    ),

  "MULTI-1": ({ catalog }) => {
    const versioned = identifiers(catalog).filter((e) => str(e.value.version));
    const seen = new Map<string, number>();
    return over(versioned, (e) => {
      const key = JSON.stringify([e.value.identifier, e.value.version]);
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, e.index);
        return [];
      }
      return [{ at: e.at, message: `"${e.value.identifier}" version "${e.value.version}" is already entry ${first}` }];
    });
  },

  "MULTI-2": ({ catalog }) => {
    const byId = groupByIdentifier(catalog);
    return over(
      identifiers(catalog).filter((e) => !has(e.value, "version")),
      (e) => {
        const others = byId.get(e.value.identifier as string)!.filter((o) => o.index !== e.index);
        return others.length === 0
          ? []
          : [{ at: e.at, message: `Entry ${e.index} has no \`version\` and shares "${e.value.identifier}" with entry ${others[0]!.index}` }];
      },
    );
  },

  "PUB-1": ({ catalog }) =>
    over(
      entries(catalog).flatMap((e) => member(e, "publisher") ?? []),
      (p) => requireMembers(p, "`publisher`", ["identifier", "displayName"]),
    ),

  "TM-1": ({ catalog }) => over(manifests(catalog), (m) => requireMembers(m, "The Trust Manifest", ["contributor"])),

  "CONTRIB-1": ({ catalog }) =>
    over(
      manifests(catalog).filter((m) => str(m.value.contributor)),
      (m) => {
        const c = m.value.contributor as string;
        return ABSOLUTE_URI.test(c) && !c.includes("#")
          ? []
          : [{ at: pointer(m.at, "contributor"), message: `"${c}" is not an absolute URI` }];
      },
    ),

  "CONTRIB-5": ({ catalog }) =>
    over(
      manifests(catalog).filter((m) => isObject(m.value.signature) && has(m.value.signature, "signer")),
      (m) => {
        const signer = (m.value.signature as JsonObject).signer;
        return signer === m.value.contributor
          ? []
          : [{ at: pointer(pointer(m.at, "signature"), "signer"), message: `\`signature.signer\` "${signer}" is not \`contributor\` "${m.value.contributor}"` }];
      },
    ),

  "VALID-1": ({ catalog }) =>
    over(manifests(catalog), (m) =>
      carriesClaim(m.value)
        ? []
        : [{ at: m.at, message: "The Trust Manifest has no `signature`, `trustSchema`, or non-empty `attestations`, `provenance`, or `extensions`" }],
    ),

  "VALID-2": ({ catalog }) =>
    over(
      manifests(catalog).filter((m) => has(m.value, "signature")),
      (m) => (has(m.value, "subject") ? [] : [{ at: m.at, message: "The Trust Manifest has a `signature` and no `subject`" }]),
    ),

  "VALID-3": ({ catalog }) =>
    over(manifests(catalog), (m) =>
      carriesClaim(m.value) ? [] : [{ at: m.at, message: "This Trust Manifest is empty; omit it" }],
    ),

  "TMOPT-2": ({ catalog }) =>
    over(manifests(catalog), (m) =>
      has(m.value, "additionalSignatures")
        ? [{ at: pointer(m.at, "additionalSignatures"), message: "`additionalSignatures` is reserved; producers should omit it" }]
        : [],
    ),

  "SUBJ-1": ({ catalog }) =>
    over(subjects(catalog), (s) => requireMembers(s, "`subject`", ["identifier", "type", "digest"])),

  "SUBJ-2": ({ catalog }) => subjectEquals(catalog, "identifier"),
  "SUBJ-3": ({ catalog }) => subjectEquals(catalog, "type"),

  "SUBJ-4": ({ catalog }) => {
    const signed = manifests(catalog).filter((m) => has(m.value, "signature"));
    const missing = [...new Set(signed.map((m) => m.entry))]
      .filter((e) => !has(e.value, "digest"))
      .map((e) => ({ at: e.at, message: `Entry ${e.index} carries a signed Trust Manifest and has no \`digest\`` }));
    const equal = subjectEquals(catalog, "digest");
    if (signed.length === 0 && equal === "n/a") return "n/a";
    return [...missing, ...(equal === "n/a" ? [] : equal)];
  },

  "SUBJ-5": ({ catalog }) =>
    over(subjects(catalog), (s) => {
      const entry = s.manifest.entry.value;
      const at = pointer(s.at, "version");
      if (has(entry, "version") !== has(s.value, "version")) {
        return [{ at, message: has(entry, "version") ? "The entry has a `version` and `subject` has none" : "`subject` has a `version` and the entry has none" }];
      }
      if (has(entry, "version") && entry.version !== s.value.version) {
        return [{ at, message: `\`subject.version\` "${s.value.version}" is not the entry's "${entry.version}"` }];
      }
      return [];
    }),

  "TSCHEMA-1": ({ catalog }) =>
    over(
      manifests(catalog).flatMap((m) => member(m, "trustSchema") ?? []),
      (t) => requireMembers(t, "`trustSchema`", ["identifier", "version"]),
    ),

  "ATTEST-1": ({ catalog }) =>
    over(
      manifests(catalog).flatMap((m) => objectsIn(m, "attestations")),
      (a) => requireMembers(a, "The attestation", ["type", "uri"]),
    ),

  "PROVLINK-1": ({ catalog }) =>
    over(
      manifests(catalog).flatMap((m) => objectsIn(m, "provenance")),
      (p) => requireMembers(p, "The provenance link", ["relation", "sourceId"]),
    ),

  "DIGEST-1": ({ catalog }) =>
    over(digests(catalog), (d) => {
      const alg = /^([a-z0-9-]+):/.exec(d.value)?.[1];
      if (alg === undefined) return []; // DIGEST-3 reports the form
      if (WEAK_DIGESTS.has(alg)) return [{ at: d.at, message: `${alg} is weaker than SHA-256` }];
      if (DIGEST_HEX_LENGTH[alg] === undefined) {
        return [{ at: d.at, message: `"${alg}" is not a known algorithm of SHA-256 strength or more` }];
      }
      return [];
    }),

  "DIGEST-3": ({ catalog }) =>
    over(digests(catalog), (d) => {
      const m = /^([a-z0-9-]+):([0-9a-f]+)$/.exec(d.value);
      if (!m) return [{ at: d.at, message: `"${d.value}" is not of the form algorithm:lowercase-hex` }];
      const length = DIGEST_HEX_LENGTH[m[1]!];
      return length === undefined || m[2]!.length === length
        ? []
        : [{ at: d.at, message: `a ${m[1]} digest is ${length} hex digits, not ${m[2]!.length}` }];
    }),

  "SIG-1": ({ catalog }) =>
    over(signatures(catalog), (s) => requireMembers(s, "The signature", ["signer", "profile", "issuedAt", "jws"])),

  "SIG-4": ({ catalog }) =>
    over(
      signatures(catalog).filter((s) => has(s.value, "expiresAt")),
      (s) => {
        const { issuedAt, expiresAt } = s.value;
        if (!str(issuedAt) || !str(expiresAt) || !isRfc3339(issuedAt) || !isRfc3339(expiresAt)) return [];
        return Date.parse(expiresAt) > Date.parse(issuedAt)
          ? []
          : [{ at: pointer(s.at, "expiresAt"), message: "`expiresAt` is not later than `issuedAt`" }];
      },
    ),

  "PROFILE-4": ({ catalog }) =>
    over(
      signatures(catalog).filter((s) => str(s.value.profile)),
      (s) => {
        const profile = s.value.profile as string;
        return profile === "did-web-v1" || ABSOLUTE_URI.test(profile)
          ? []
          : [{ at: pointer(s.at, "profile"), message: `"${profile}" is neither \`did-web-v1\` nor an absolute URI` }];
      },
    ),

  "EXTKEY-2": ({ catalog }) =>
    over(extensionMaps(catalog), (x) =>
      Object.keys(x.value)
        .filter((k) => !isUrl(k) && !REVERSE_DNS.test(k))
        .map((k) => ({ at: pointer(x.at, k), message: `extension key "${k}" is neither a URL nor a reverse-DNS name` })),
    ),

  "POLICY-1": ({ catalog }) =>
    over(
      entries(catalog).filter((e) => isObject(e.value.extensions) && has(e.value.extensions, POLICY_URLS)),
      (e) =>
        isObject((e.value.extensions as JsonObject)[POLICY_URLS])
          ? []
          : [{ at: pointer(pointer(e.at, "extensions"), POLICY_URLS), message: "the Policy URLs extension's value is not an object" }],
    ),

  "STABLE-1": ({ catalog, facts }) => {
    // The spec's open objects; members it does not define are allowed there, and reported.
    const unknown = (item: At<JsonObject>, name: string) =>
      Object.keys(item.value)
        .filter((k) => !Object.hasOwn(rule(facts, name).members, k))
        .map((k) => ({ at: pointer(item.at, k), message: `\`${k}\` is not defined by the spec; custom data belongs in \`extensions\`` }));
    const host = hostOf(catalog);
    return [
      ...unknown(root(catalog), "AICatalog"),
      ...(host ? unknown(host, "HostInfo") : []),
      ...entries(catalog).flatMap((e) => unknown(e, "CatalogEntry")),
      ...entries(catalog).flatMap((e) => member(e, "publisher") ?? []).flatMap((p) => unknown(p, "Publisher")),
    ];
  },

  "SVPROD-1": ({ catalog, specVersion }) => {
    if (!str(catalog.specVersion)) return "n/a";
    return catalog.specVersion === specVersion
      ? []
      : [{ at: "/specVersion", message: `is "${catalog.specVersion}", and this run checks the catalog against AI Catalog "${specVersion}"` }];
  },

  "TYPO-2": ({ catalog }) =>
    over(identifiers(catalog), (e) => {
      const id = e.value.identifier as string;
      return /^(urn:air:|did:|https:\/\/)/.test(id)
        ? []
        : [{ at: pointer(e.at, "identifier"), message: `"${id}" is not anchored to a domain (a \`urn:air\` URN, a DID, or an https URL)` }];
    }),

  "PRIVACY-1": ({ catalog }) => {
    const logo = hostOf(catalog)?.value.logoUrl;
    if (!str(logo)) return "n/a";
    return logo.startsWith("data:") ? [] : [{ at: "/host/logoUrl", message: "`logoUrl` is not a Data URI, so fetching it reveals the client" }];
  },

  "CDDL-AICatalog": ({ catalog, facts }) => cddl(facts, "AICatalog", [root(catalog)]),
  "CDDL-HostInfo": ({ catalog, facts }) => cddl(facts, "HostInfo", hostOf(catalog) ? [hostOf(catalog)!] : []),
  "CDDL-CatalogEntry": ({ catalog, facts }) => cddl(facts, "CatalogEntry", entries(catalog)),
  "CDDL-Publisher": ({ catalog, facts }) =>
    cddl(facts, "Publisher", entries(catalog).flatMap((e) => member(e, "publisher") ?? [])),
  "CDDL-TrustManifest": ({ catalog, facts }) => cddl(facts, "TrustManifest", manifests(catalog)),
  "CDDL-Subject": ({ catalog, facts }) => cddl(facts, "Subject", subjects(catalog)),
  "CDDL-Signature": ({ catalog, facts }) => cddl(facts, "Signature", signatures(catalog)),
  "CDDL-TrustSchema": ({ catalog, facts }) =>
    cddl(facts, "TrustSchema", manifests(catalog).flatMap((m) => member(m, "trustSchema") ?? [])),
  "CDDL-Attestation": ({ catalog, facts }) =>
    cddl(facts, "Attestation", manifests(catalog).flatMap((m) => objectsIn(m, "attestations"))),
  "CDDL-ProvenanceLink": ({ catalog, facts }) =>
    cddl(facts, "ProvenanceLink", manifests(catalog).flatMap((m) => objectsIn(m, "provenance"))),
  "CDDL-PolicyUrls": ({ catalog, facts }) =>
    cddl(facts, 
      "PolicyUrls",
      entries(catalog).flatMap((e) => {
        const x = member(e, "extensions");
        return x ? (member(x, POLICY_URLS) ?? []) : [];
      }),
    ),
};

function groupByIdentifier(catalog: JsonObject) {
  const byId = new Map<string, ReturnType<typeof entries>>();
  for (const e of identifiers(catalog)) {
    const id = e.value.identifier as string;
    byId.set(id, [...(byId.get(id) ?? []), e]);
  }
  return byId;
}

function subjectEquals(catalog: JsonObject, key: "identifier" | "type" | "digest"): Outcome {
  return over(
    subjects(catalog).filter((s) => has(s.value, key)),
    (s) => {
      const entryValue = s.manifest.entry.value[key];
      return s.value[key] === entryValue
        ? []
        : [{ at: pointer(s.at, key), message: `\`subject.${key}\` "${s.value[key]}" is not the entry's ${entryValue === undefined ? "(absent)" : `"${entryValue}"`}` }];
    },
  );
}
