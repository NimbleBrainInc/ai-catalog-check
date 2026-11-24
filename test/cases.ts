// A catalog that uses every part of the spec, and one way to break each checked
// requirement. checks.test.ts runs them; sdk-oracle.test.ts runs them through the SDK.

import { readFileSync } from "node:fs";
import { type Report, run, type Status } from "../src/run.ts";

type Catalog = any;

export const COMPLETE = readFileSync(new URL("./fixtures/complete.json", import.meta.url), "utf8");

export async function check(mutate: (c: Catalog) => void): Promise<Report> {
  const catalog = JSON.parse(COMPLETE);
  mutate(catalog);
  return run({ text: JSON.stringify(catalog, null, 2), source: "test" });
}

export function statusOf(report: Report, id: string): Status | undefined {
  return report.results.find((r) => r.id === id)?.status;
}

const signed = (c: Catalog) => c.entries[1].trustManifests[0];

const KID = "did:web:acme.example#release-key";
const HEADER = { alg: "ES256", kid: KID, typ: "ai-catalog-trust-manifest+jws" };

/** A JWS of the stored form with this protected header and an n-byte signature. */
function jws(header: object | string, n = 64): string {
  const h = Buffer.from(typeof header === "string" ? header : JSON.stringify(header)).toString("base64url");
  return `${h}..${Buffer.alloc(n, 7).toString("base64url")}`;
}

/** Changes the signer everywhere it must agree: contributor, signer, and kid. */
function setSigner(c: Catalog, signer: string) {
  signed(c).contributor = signer;
  signed(c).signature.signer = signer;
  signed(c).signature.jws = jws({ ...HEADER, kid: `${signer}#release-key` });
}
const assessor = (c: Catalog) => c.entries[1].trustManifests[1];

export interface Case {
  id: string;
  expect: Status;
  why: string;
  mutate: (c: Catalog) => void;
}

export const CASES: Case[] = [
  { id: "TOP-1", expect: "fail", why: "no entries", mutate: (c) => delete c.entries },
  { id: "TOP-1", expect: "fail", why: "no specVersion", mutate: (c) => delete c.specVersion },
  { id: "TOP-2", expect: "warn", why: "additionalSignatures", mutate: (c) => (c.additionalSignatures = []) },
  { id: "HOST-1", expect: "fail", why: "host without displayName", mutate: (c) => delete c.host.displayName },
  { id: "ENTRY-1", expect: "fail", why: "entry without type", mutate: (c) => delete c.entries[0].type },
  { id: "ENTRY-1", expect: "fail", why: "entry without identifier", mutate: (c) => delete c.entries[0].identifier },
  { id: "ENTRY-3", expect: "warn", why: "identifier without a scheme", mutate: (c) => (c.entries[0].identifier = "weather") },
  { id: "ENTRY-4", expect: "warn", why: "not urn:air", mutate: (c) => (c.entries[0].identifier = "https://acme.example/weather") },
  { id: "ENTRY-4", expect: "warn", why: "publisher not a domain", mutate: (c) => (c.entries[0].identifier = "urn:air:acme:weather:mcp") },
  { id: "ENTRY-4", expect: "warn", why: "too many segments", mutate: (c) => (c.entries[0].identifier = "urn:air:acme.example:a:b:c") },
  { id: "ENTRY-6", expect: "notice", why: "unknown type", mutate: (c) => (c.entries[0].type = "application/mcp-server-cards+json") },
  { id: "ENTRY-7", expect: "fail", why: "neither url nor data", mutate: (c) => delete c.entries[0].url },
  { id: "ENTRY-7", expect: "fail", why: "both url and data", mutate: (c) => (c.entries[0].data = {}) },
  { id: "ENTRY-14", expect: "warn", why: "not semver", mutate: (c) => (c.entries[2].version = "v2") },
  { id: "ENTRY-16", expect: "fail", why: "repeated identifier without version", mutate: (c) => delete c.entries[2].version },
  { id: "MULTI-1", expect: "fail", why: "same identifier and version twice", mutate: (c) => (c.entries[2].version = "2.1.0") },
  { id: "MULTI-2", expect: "fail", why: "unversioned identifier repeated", mutate: (c) => (c.entries[3].identifier = c.entries[0].identifier) },
  { id: "PUB-1", expect: "fail", why: "publisher without displayName", mutate: (c) => delete c.entries[0].publisher.displayName },
  { id: "TM-1", expect: "fail", why: "manifest without contributor", mutate: (c) => delete assessor(c).contributor },
  { id: "CONTRIB-1", expect: "fail", why: "relative contributor", mutate: (c) => (assessor(c).contributor = "assessor") },
  { id: "CONTRIB-5", expect: "fail", why: "signer is not contributor", mutate: (c) => (signed(c).signature.signer = "did:web:other.example") },
  {
    id: "VALID-1",
    expect: "fail",
    why: "manifest with no claim",
    mutate: (c) => c.entries[1].trustManifests.push({ contributor: "https://x.example", attestations: [] }),
  },
  { id: "VALID-2", expect: "fail", why: "signature without subject", mutate: (c) => delete signed(c).subject },
  {
    id: "VALID-3",
    expect: "fail",
    why: "manifest with only contributor",
    mutate: (c) => c.entries[1].trustManifests.push({ contributor: "https://x.example" }),
  },
  { id: "TMOPT-2", expect: "warn", why: "manifest additionalSignatures", mutate: (c) => (signed(c).additionalSignatures = []) },
  { id: "SUBJ-1", expect: "fail", why: "subject without digest", mutate: (c) => delete signed(c).subject.digest },
  { id: "SUBJ-2", expect: "fail", why: "subject identifier differs", mutate: (c) => (signed(c).subject.identifier = "urn:air:acme.example:other:a2a") },
  { id: "SUBJ-3", expect: "fail", why: "subject type differs", mutate: (c) => (signed(c).subject.type = "application/mcp-server-card+json") },
  { id: "SUBJ-4", expect: "fail", why: "subject digest differs", mutate: (c) => (signed(c).subject.digest = `sha256:${"0".repeat(64)}`) },
  { id: "SUBJ-4", expect: "fail", why: "signed entry without digest", mutate: (c) => delete c.entries[1].digest },
  { id: "SUBJ-5", expect: "fail", why: "subject version differs", mutate: (c) => (signed(c).subject.version = "2.0.0") },
  { id: "SUBJ-5", expect: "fail", why: "subject version absent", mutate: (c) => delete signed(c).subject.version },
  { id: "TSCHEMA-1", expect: "fail", why: "trustSchema without version", mutate: (c) => delete assessor(c).trustSchema.version },
  { id: "ATTEST-1", expect: "fail", why: "attestation without uri", mutate: (c) => delete assessor(c).attestations[0].uri },
  { id: "PROVLINK-1", expect: "fail", why: "provenance without sourceId", mutate: (c) => delete assessor(c).provenance[0].sourceId },
  { id: "DIGEST-1", expect: "warn", why: "sha1", mutate: (c) => (c.entries[3].digest = `sha1:${"a".repeat(40)}`) },
  { id: "DIGEST-1", expect: "warn", why: "unknown algorithm", mutate: (c) => (c.entries[3].digest = `blake9:${"a".repeat(64)}`) },
  { id: "DIGEST-3", expect: "fail", why: "uppercase hex", mutate: (c) => (c.entries[3].digest = c.entries[3].digest.toUpperCase().replace("SHA512", "sha512")) },
  { id: "DIGEST-3", expect: "fail", why: "short hex", mutate: (c) => (c.entries[3].digest = "sha256:abc") },
  { id: "DIGEST-3", expect: "fail", why: "no algorithm", mutate: (c) => (c.entries[3].digest = "abc") },
  { id: "SIG-1", expect: "fail", why: "signature without jws", mutate: (c) => delete signed(c).signature.jws },
  { id: "SIG-4", expect: "fail", why: "expires before issued", mutate: (c) => (signed(c).signature.expiresAt = "2026-10-01T10:00:00Z") },
  { id: "SIG-5", expect: "fail", why: "attached payload", mutate: (c) => (signed(c).signature.jws = signed(c).signature.jws.replace("..", ".e30.")) },
  { id: "SIG-5", expect: "fail", why: "padded base64", mutate: (c) => (signed(c).signature.jws += "=") },
  { id: "SIG-5", expect: "fail", why: "header not JSON", mutate: (c) => (signed(c).signature.jws = jws("not json")) },
  { id: "JWS-5", expect: "fail", why: "no typ", mutate: (c) => (signed(c).signature.jws = jws({ alg: "ES256", kid: KID })) },
  { id: "JWS-6", expect: "fail", why: "catalog typ in a manifest", mutate: (c) => (signed(c).signature.jws = jws({ ...HEADER, typ: "ai-catalog+jws" })) },
  { id: "JWS-8", expect: "fail", why: "alg none", mutate: (c) => (signed(c).signature.jws = jws({ ...HEADER, alg: "none" })) },
  { id: "JWS-9", expect: "fail", why: "b64", mutate: (c) => (signed(c).signature.jws = jws({ ...HEADER, b64: false })) },
  { id: "DIDWEB-1", expect: "fail", why: "did:web with a path", mutate: (c) => setSigner(c, "did:web:acme.example:users:alice") },
  { id: "DIDWEB-2", expect: "fail", why: "uppercase domain", mutate: (c) => setSigner(c, "did:web:Acme.example") },
  { id: "DIDWEB-2", expect: "fail", why: "port", mutate: (c) => setSigner(c, "did:web:acme.example%3A8443") },
  { id: "DIDALG-1", expect: "fail", why: "RS256", mutate: (c) => (signed(c).signature.jws = jws({ ...HEADER, alg: "RS256" })) },
  { id: "DIDALG-1", expect: "fail", why: "short signature", mutate: (c) => (signed(c).signature.jws = jws(HEADER, 32)) },
  { id: "DIDALG-3", expect: "fail", why: "no kid", mutate: (c) => (signed(c).signature.jws = jws({ alg: "ES256", typ: HEADER.typ })) },
  { id: "DIDALG-4", expect: "fail", why: "jwk", mutate: (c) => (signed(c).signature.jws = jws({ ...HEADER, jwk: {} })) },
  { id: "DIDALG-5", expect: "fail", why: "kid of another DID", mutate: (c) => (signed(c).signature.jws = jws({ ...HEADER, kid: "did:web:other.example#k" })) },
  { id: "DIDALG-5", expect: "fail", why: "kid with empty fragment", mutate: (c) => (signed(c).signature.jws = jws({ ...HEADER, kid: "did:web:acme.example#" })) },
  { id: "PROFILE-4", expect: "fail", why: "relative profile", mutate: (c) => (signed(c).signature.profile = "my-profile") },
  { id: "EXTKEY-2", expect: "fail", why: "bare key", mutate: (c) => (c.extensions.region = "us") },
  { id: "EXTKEY-2", expect: "fail", why: "bare entry key", mutate: (c) => (c.entries[0].extensions.custom = {}) },
  {
    id: "POLICY-1",
    expect: "fail",
    why: "policy urls not an object",
    mutate: (c) => (c.entries[0].extensions["https://ai-catalog.org/extensions/policy-urls"] = "https://acme.example/privacy"),
  },
  { id: "STABLE-1", expect: "warn", why: "unrecognized entry member", mutate: (c) => (c.entries[0].region = "us") },
  { id: "STABLE-1", expect: "warn", why: "unrecognized catalog member", mutate: (c) => (c.generator = "x") },
  { id: "SVPROD-1", expect: "fail", why: "not Major.Minor", mutate: (c) => (c.specVersion = "0.9.0") },
  { id: "TYPO-2", expect: "warn", why: "http URL identifier", mutate: (c) => (c.entries[0].identifier = "http://acme.example/weather") },
  { id: "PRIVACY-1", expect: "warn", why: "https logo", mutate: (c) => (c.host.logoUrl = "https://acme.example/logo.svg") },
  { id: "ENTRY-18", expect: "fail", why: "unsafe integer in data", mutate: (c) => (c.entries[4].data.big = "__BIG__") },
  { id: "ENTRY-18", expect: "fail", why: "unsafe integer in exponent form", mutate: (c) => (c.entries[4].data.big = "__BIG_EXP__") },
  { id: "ENTRY-18", expect: "fail", why: "number beyond a double's range", mutate: (c) => (c.entries[4].data.big = "__OVERFLOW__") },
  { id: "CDDL-AICatalog", expect: "fail", why: "entries holds a string", mutate: (c) => c.entries.push("x") },
  { id: "CDDL-AICatalog", expect: "fail", why: "specVersion number", mutate: (c) => (c.specVersion = 0.9) },
  { id: "CDDL-HostInfo", expect: "fail", why: "displayName number", mutate: (c) => (c.host.displayName = 1) },
  { id: "CDDL-CatalogEntry", expect: "fail", why: "tags not strings", mutate: (c) => (c.entries[0].tags = [1]) },
  { id: "CDDL-CatalogEntry", expect: "fail", why: "updatedAt not RFC 3339", mutate: (c) => (c.entries[0].updatedAt = "2026-11-01") },
  { id: "CDDL-CatalogEntry", expect: "fail", why: "updatedAt on February 31", mutate: (c) => (c.entries[0].updatedAt = "2026-02-31T12:00:00Z") },
  { id: "CDDL-CatalogEntry", expect: "fail", why: "updatedAt on February 29 of a common year", mutate: (c) => (c.entries[0].updatedAt = "2100-02-29T12:00:00Z") },
  { id: "CDDL-CatalogEntry", expect: "fail", why: "updatedAt on April 31", mutate: (c) => (c.entries[0].updatedAt = "2026-04-31T12:00:00Z") },
  { id: "CDDL-Publisher", expect: "fail", why: "identityType number", mutate: (c) => (c.entries[0].publisher.identityType = 1) },
  { id: "CDDL-TrustManifest", expect: "fail", why: "attestations not array", mutate: (c) => (assessor(c).attestations = {}) },
  { id: "CDDL-Subject", expect: "fail", why: "subject version number", mutate: (c) => (signed(c).subject.version = 2) },
  { id: "CDDL-Signature", expect: "fail", why: "issuedAt not a date", mutate: (c) => (signed(c).signature.issuedAt = "yesterday") },
  { id: "CDDL-Signature", expect: "fail", why: "issuedAt on February 30", mutate: (c) => (signed(c).signature.issuedAt = "2026-02-30T00:00:00Z") },
  { id: "CDDL-TrustSchema", expect: "fail", why: "verificationMethods not strings", mutate: (c) => (assessor(c).trustSchema.verificationMethods = [1]) },
  { id: "CDDL-Attestation", expect: "fail", why: "negative size", mutate: (c) => (assessor(c).attestations[0].size = -1) },
  { id: "CDDL-ProvenanceLink", expect: "fail", why: "relation number", mutate: (c) => (assessor(c).provenance[0].relation = 1) },
  {
    id: "CDDL-PolicyUrls",
    expect: "fail",
    why: "privacyPolicyUrl number",
    mutate: (c) => (c.entries[0].extensions["https://ai-catalog.org/extensions/policy-urls"].privacyPolicyUrl = 1),
  },
];

/** The text of the complete catalog with a case's change made. */
export function mutated(c: Case): string {
  const catalog = JSON.parse(COMPLETE);
  c.mutate(catalog);
  // JSON.stringify cannot write an unsafe number, so ENTRY-18's cases splice one in.
  return JSON.stringify(catalog, null, 2)
    .replace('"__BIG__"', "9007199254740993")
    .replace('"__BIG_EXP__"', "9007199254740993e0")
    .replace('"__OVERFLOW__"', "1e400");
}
