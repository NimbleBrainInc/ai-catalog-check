# ai-catalog-conformance

A conformance suite for the [AI Catalog specification](https://ai-catalog.io/spec/)
(`application/ai-catalog+json`). Every normative statement of the spec is numbered,
quoted word for word, and either checked, pending, or excluded with a reason. Each
finding names the requirement it breaks and links to it in the spec.

It covers **AI Catalog 0.9** (the 1.0 release candidate,
[v0.9.0](https://github.com/Agent-Card/ai-catalog/releases/tag/v0.9.0)).

## Use it in GitHub Actions

```yaml
- uses: NimbleBrainInc/ai-catalog-conformance@v0.1.0
  with:
    catalogs: dist/.well-known/ai-catalog.json
```

Each finding becomes an annotation on the catalog's line in the pull request, and
the report goes to the job summary. Inputs:

| Input | Default | |
|---|---|---|
| `catalogs` | (required) | Files or URLs, one per line |
| `profile` | | Profiles to check as well, one per line (`nimblebrain`) |
| `fetch` | `false` | Also fetch the catalog's URL and the artifacts its entries name |
| `baseline` | | A YAML file of failures to expect (see below) |
| `strict` | `false` | Fail on warnings too |
| `spec` | `0.9` | The spec version to check against |

Check the built file before merge, and the live catalog with `fetch: true` on a
schedule: fetching checks what only the served copy shows (media types, digests
against the bytes, names and versions the artifacts carry), and a catalog checked
before it deploys may name artifacts that are not live yet.

## Use it from the command line

```sh
npx github:NimbleBrainInc/ai-catalog-conformance#v0.1.0 ./ai-catalog.json
npx github:NimbleBrainInc/ai-catalog-conformance#v0.1.0 --fetch https://example.com/.well-known/ai-catalog.json
```

```
AI Catalog 0.9: https://example.com/.well-known/ai-catalog.json
not conformant. Level 3 (Trusted) is not assessed.

✗ SVPROD-1 MUST
    /specVersion (line 2): is "1.0"; this suite checks AI Catalog "0.9"
    https://ai-catalog.io/spec/#producer-behavior
```

`--format json` gives the whole report to a program; `--format github` writes
workflow annotations. The exit code is 1 when a requirement fails.

## What a result means

A requirement's strength decides what breaking it does:

| Status | When |
|---|---|
| `fail` | A MUST or MUST NOT is broken. The run fails. |
| `warn` | A SHOULD or SHOULD NOT is broken. The run passes unless `--strict`. |
| `notice` | Worth a look, not a breach (an unrecognized `type`). |
| `n/a` | The catalog has nothing the requirement applies to. |
| `skipped` | It needs `--fetch`. |
| `expected` | It fails, and the baseline says to expect that. |

The report gives the catalog's [conformance level](https://ai-catalog.io/spec/#conformance-levels):
Level 1 (Minimal) when no MUST of the spec fails, Level 2 (Discoverable) when it
also has a `host`. Level 3 (Trusted) needs signature verification, which the suite
does not do yet.

## The requirements

[`requirements/0.9.yaml`](requirements/0.9.yaml) holds one entry for every sentence
of the spec that carries MUST, SHALL, REQUIRED, SHOULD or RECOMMENDED, one for each
CDDL rule, and one for each definition the spec states without a keyword (the digest
format, the stored JWS form). Each entry has an ID (`ENTRY-7`, `SUBJ-4`, `CDDL-Publisher`),
the role it binds, and one disposition:

- **checked**: from the document alone, or by fetching (`check: document | fetch`)
- **pending**: checkable and not yet built, with the reason (mostly Level 3 signature verification)
- **excluded**: not checkable from a catalog (it binds consumers, or needs the catalog's history, or is a judgment), or checked under another ID

[COVERAGE.md](COVERAGE.md) lists all of them with the current counts. Most of
what is not checked binds consumers and signature verifiers, not the catalog.

Tests hold the registry to the spec: every normative statement of the vendored
spec has exactly one entry, every checked entry has a check and a test that breaks
it, and every check belongs to an entry.

## Profiles

A profile adds an organization's own conventions on top of the spec, under its own
IDs. `--profile nimblebrain` ([profiles/nimblebrain.yaml](profiles/nimblebrain.yaml))
requires `urn:air:{publisher}:{name}:{kind}` identifiers whose kind matches the
entry's type, and a `publisher` that matches the identifier's domain.

## Baseline

A catalog that knowingly fails a requirement can say so, with a reason:

```yaml
expected:
  - id: LOC-1
    reason: GitHub Pages cannot serve application/ai-catalog+json
```

An expected failure does not fail the run. A baseline entry that no longer fails
does, so the baseline only ever shrinks.

## Cross-checked against the SDK

CI builds [Vercel's TypeScript SDK](https://github.com/vercel-labs/ai-catalog-sdk) at
its 0.9 release and runs it on the same corpus (a complete catalog, one break of each
requirement, and the spec's examples). Whatever the SDK rejects, the suite must fail
on a MUST of the spec.

## Findings about the spec and SDK

- The spec's multi-artifact example (and `specification/examples/ai-catalog.json`)
  signs with the placeholder `detached-jws-signature`, which is not canonical base64url
  nor an ES256 signature's 64 bytes. The SDK rejects it as well.
- The SDK (0.1.0) accepts catalogs that break these MUSTs: a `specVersion` other than
  its own (SVPROD-1), extension keys that are neither URLs nor reverse-DNS (EXTKEY-2),
  a Policy URLs value that is not an object or has non-string members (POLICY-1,
  CDDL-PolicyUrls), and inline `data` outside I-JSON (ENTRY-18).

## License

The code is [Apache-2.0](LICENSE). The specification text in `spec/` and quoted in
`requirements/` is the AI Catalog Working Group's, under
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/); see [NOTICE](NOTICE).
