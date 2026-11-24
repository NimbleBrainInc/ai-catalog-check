# ai-catalog-check

Check an [AI Catalog](https://ai-catalog.io/spec/) against the spec. Point it at your
website or your `ai-catalog.json` and it tells you whether the catalog conforms, at
which level, and which spec requirement each problem breaks, with the line it is on.

It checks each catalog against the AI Catalog version the catalog declares. This
release checks **AI Catalog 0.9**, the 1.0 release candidate
([v0.9.0](https://github.com/Agent-Card/ai-catalog/releases/tag/v0.9.0)).

## Check your catalog

You need Node.js 20.19 or later.

```sh
npx github:NimbleBrainInc/ai-catalog-check#v0.1.0 https://your-site.example
```

Pass your website, your catalog's URL, or a local file. For a website, the suite
finds the catalog the way the spec tells an agent to: from a `Link` header with
`rel="ai-catalog"`, then from an HTML `<link rel="ai-catalog">`, then at
`/.well-known/ai-catalog.json`.

A catalog that fails looks like this:

```
AI Catalog 0.9 · ai-catalog.json

✗ Not conformant: 1 MUST fails

  ✗ DIGEST-3  Digests are algorithm:lowercase-hex  MUST
      line 18  /entries/1/digest  "sha256:9F86D081…" is not of the form algorithm:lowercase-hex
      https://ai-catalog.io/spec/#digest-format

16 passed · 1 failed · 45 not applicable · 7 need --fetch
```

Read it top down:

1. **What it checked.** The AI Catalog version it checked against and the catalog's
   location. For a website, a second line says how it found the catalog.
2. **The verdict.** `✓ Conforms at Level 2 (Discoverable)`, or `✗ Not conformant`
   with the number of MUSTs that fail.
3. **Each problem.** Its ID and name, the requirement's strength, then each place in
   your catalog that breaks it (line, JSON path, what is wrong), then a link to the
   spec section.
4. **The counts.** The summary leaves out the zeros.

The command exits with 0 when nothing fails, 1 when a requirement fails, and 2 when
you call it wrong. CI reads that exit code.

## Fix what it finds

Start with the `✗` lines. Each one breaks a MUST, and the catalog does not conform
until you fix it. The finding tells you what it found, and the link takes you to the
sentence of the spec that requires otherwise. In the example above, the digest's hex
is uppercase, and the fix is to write it in lowercase.

`!` lines break a SHOULD: something the spec recommends and your catalog does not
do. They fail the run only when you pass `--strict`. An `i` line is a notice. The spec hedges a few
recommendations with "when applicable", and only you can say whether one applies.

To see what the suite checked, passing results included, add `-v`:

```
✗ Not conformant: 1 MUST fails

Catalog
  ✓ TOP-1                Catalog has specVersion and entries               MUST
  ✓ TOP-2                Catalog omits additionalSignatures                SHOULD
  ✓ HOST-1               Host has a displayName                            MUST
  ✓ SVPROD-1             specVersion is the version implemented            MUST
  · PRIVACY-1            Host logo is a Data URI                           n/a
...
Trust Manifests
  · 15 requirements, none applicable to this catalog
```

[COVERAGE.md](COVERAGE.md) lists every requirement by ID with the spec's sentence.
Look an ID up there when the name alone does not tell you enough.

## Spec versions

The catalog's `specVersion` picks the version it is checked against, so a 0.9
catalog is checked as 0.9 and, once a release checks 1.0, a 1.0 catalog as 1.0.
`--version` lists the versions a release checks:

```
$ npx github:NimbleBrainInc/ai-catalog-check#v0.1.0 --version
ai-catalog-check 0.1.0 (checks AI Catalog 0.9)
```

A catalog that declares a version the release does not check gets one line instead
of a report:

```
✗ Declares AI Catalog 1.0, which this release does not check (it checks 0.9).
  If the catalog follows 0.9, set "specVersion": "0.9". To check it against 0.9 as it is, pass --spec 0.9.
```

`--spec <version>` checks against a version you name, whatever the catalog declares.
Use it to see how a catalog fares against a version before you move it there. The
version of `ai-catalog-check` itself says nothing about the spec: a new spec version
arrives in a minor release, beside the versions already checked.

## Levels

The spec defines [three conformance levels](https://ai-catalog.io/spec/#conformance-levels):

| Level | You get it when |
|---|---|
| 1 Minimal | No MUST fails |
| 2 Discoverable | Level 1, and the catalog has a `host` naming its operator |
| 3 Trusted | Entries carry signed Trust Manifests that verify. The suite does not verify signatures yet, so it never reports Level 3. |

The level judges the document alone. A file and its live copy get the same level.

## Check the live copy

Add `--fetch` to also check what only the served catalog shows:

- the media type each URL serves (`application/ai-catalog+json` for the catalog,
  and the `type` an entry declares for its artifact)
- each `digest` against the bytes its URL serves
- names, descriptions and versions an entry restates from the MCP Server Card or
  A2A Agent Card it points to

These results print on their own line under the verdict. They do not change the
level, but a failure among them still fails the run. Leave `--fetch` off when you
check a build before you deploy it, because its entries may point at artifacts that
are not live yet.

## Let an agent do it

The repository ships an [Agent Skill](skills/ai-catalog-check/SKILL.md) that teaches a
coding agent to run the check, fix what it finds where the catalog comes from, start
a new catalog, and add the check to CI. Install it with the
[skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add NimbleBrainInc/ai-catalog-check
```

Then ask your agent to check your catalog.

## Run it in CI

The repository is also a GitHub Action. Each problem becomes an annotation on the
catalog's line in the pull request, and the report appears on the job's summary page.

Check the catalog your build produces, on every pull request:

```yaml
name: AI Catalog
on: pull_request
jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build      # whatever writes your catalog
      - uses: NimbleBrainInc/ai-catalog-check@v0.1.0
        with:
          catalogs: dist/.well-known/ai-catalog.json
```

Check the live site on a schedule, so a broken deploy or a moved artifact shows up:

```yaml
name: AI Catalog (live)
on:
  schedule:
    - cron: "0 6 * * *"
jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: NimbleBrainInc/ai-catalog-check@v0.1.0
        with:
          catalogs: https://your-site.example
          fetch: true
```

| Input | Default | |
|---|---|---|
| `catalogs` | required | Files, catalog URLs or websites, one per line |
| `fetch` | `false` | Also check the live copy and its artifacts |
| `baseline` | | A file of failures to expect (below) |
| `strict` | `false` | Fail on warnings as well |
| `spec` | | Check against this AI Catalog version instead of the one each catalog declares |
| `verbose` | `false` | List every result in the job summary |

Pin the action to a version tag (`@v0.1.0`) or a commit SHA. A new release can add a
check that your catalog fails.

## Options

| Flag | |
|---|---|
| `--fetch` | Also check the live copy and its artifacts |
| `-v`, `--verbose` | List every result by part of the spec, passing ones too, and every finding |
| `--strict` | Fail on warnings as well as failures |
| `--spec <version>` | Check against this AI Catalog version instead of the one the catalog declares |
| `--version` | Print this release's version and the AI Catalog versions it checks |
| `--baseline <file>` | Expect the failures the file lists |
| `--format text\|json\|github` | `json` gives a program the whole report; `github` writes workflow annotations |

## Expect a failure you cannot fix yet

Some failures and warnings sit outside your control for a while. GitHub Pages, for example,
cannot serve `application/ai-catalog+json`. List those in a baseline file with the
reason:

```yaml
expected:
  - id: LOC-1
    reason: GitHub Pages cannot set the media type
```

```sh
npx github:NimbleBrainInc/ai-catalog-check#v0.1.0 --baseline ai-catalog-baseline.yaml --fetch https://your-site.example
```

An expected result shows as `~`, with your reason, and does not fail the run, even
with `--strict`. An expected MUST still costs the level, because the catalog still
breaks it. When the problem goes away, or an entry names an ID the suite does not
check, the run fails until you fix the entry, so the file lists only problems you
still have.

## How the suite works

**Every requirement has an ID.** [`requirements/`](requirements) holds, for each spec
version,
one entry for each sentence of the spec that says MUST, SHALL, REQUIRED, SHOULD or
RECOMMENDED, quoted word for word. It also holds one entry for each CDDL rule and one
for each definition the spec states without a keyword, such as the digest format.
Each one has a permanent ID (`ENTRY-7`, `SUBJ-4`),
the role it binds, and one of three dispositions:

- **checked**, from the document alone or by fetching
- **pending**, checkable but not built yet, with the reason (mostly signature verification)
- **excluded**, with the reason: it binds consumers rather than catalogs, needs the
  catalog's history, calls for judgment, or restates a requirement checked under
  another ID

[COVERAGE.md](COVERAGE.md) lists them all, with the counts.

**The strength decides the result.** A broken MUST fails and a broken SHOULD warns.
No check overrides that.

**The suite reads facts from the spec.** It takes the members and types of each
object from the spec's CDDL, and the media types and signature `typ` values from
the spec's own lists. Nothing restates them in code, so the next spec version
updates them.

**Tests hold the suite to the spec.** They re-read the vendored spec in
[`spec/`](spec) and fail when a normative sentence has no entry or an entry quotes
text the spec does not contain. Every checked requirement has a check and a test
that breaks it. The spec's own example catalogs run through the suite.

**CI cross-checks it against another implementation.** It builds
[Vercel's TypeScript SDK](https://github.com/vercel-labs/ai-catalog-sdk) at its 0.9
release, runs both on the same catalogs, and fails if the SDK rejects a catalog that
passes every MUST here.

**Each catalog is checked against the version it declares.** A release can check
several AI Catalog versions; `--version` lists them. The catalog's `specVersion`
picks one. When a requirement changes meaning between versions, the new version gives
it a new ID, so no check means two things.

## Problems found in the spec and the SDK

- The spec's multi-artifact example, and `specification/examples/ai-catalog.json`,
  sign with the placeholder `detached-jws-signature`. That value is neither canonical
  base64url nor the 64 bytes of an ES256 signature, and the SDK rejects it too.
- The SDK (0.1.0) accepts catalogs that break five MUSTs: a `specVersion` other than
  its own (SVPROD-1), extension keys that are neither URLs nor reverse-DNS names
  (EXTKEY-2), a Policy URLs value that is not an object (POLICY-1) or has non-string
  members (CDDL-PolicyUrls), and inline `data` outside I-JSON (ENTRY-18).

## License

The code is [Apache-2.0](LICENSE). The spec text in `spec/` and quoted in
`requirements/` belongs to the AI Catalog Working Group and is licensed
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). See [NOTICE](NOTICE).
