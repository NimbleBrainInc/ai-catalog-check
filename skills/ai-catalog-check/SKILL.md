---
name: ai-catalog-check
description: Checks, fixes, writes and CI-gates AI Catalog documents (ai-catalog.json, application/ai-catalog+json) with the ai-catalog-check CLI, which tests a catalog against every checkable requirement of the AI Catalog spec and names each problem by requirement ID. Use when creating or editing an AI Catalog, adding an entry for an MCP server, agent, skill or plugin, asking whether a catalog or a website's catalog is valid, or adding a conformance check to CI. Triggers include "check my AI catalog", "is this ai-catalog.json valid", "why does the catalog check fail", "add an AI Catalog to this site", "set up ai-catalog-check in CI".
---

# AI Catalog check

`ai-catalog-check` decides whether an AI Catalog conforms to the spec. Run it, fix
what it reports at the place the catalog comes from, and run it again until it
conforms. Do not judge conformance yourself: the CLI holds the spec's
requirements, and its verdict is the answer.

## Quick start

```sh
npx -y ai-catalog-check --format json <file-or-url>
```

Pass a local `ai-catalog.json`, a catalog URL, or a website (the CLI finds the
catalog through its `Link` header, then `<link rel="ai-catalog">`, then
`/.well-known/ai-catalog.json`). Node.js 20.19 or later. In CI, pin a version
(`npx -y ai-catalog-check@0.1.2`).

The catalog's `specVersion` picks the AI Catalog version it is checked against.
`--version` lists the versions a release checks; `--spec <version>` checks against
a version you name instead.

The JSON report gives you what you act on:

| Field | Meaning |
|---|---|
| `level` | 0 not conformant, 1 Minimal, 2 Discoverable (Level 3 is not assessed) |
| `failed` | Whether the run fails; the exit code is 1 when it does |
| `spec` | The AI Catalog version checked against (`version`) and how it was chosen (`chosen`: `declared`, `requested`, `latest`) |
| `notCatalog` | Present when the input is not a catalog at all, with why |
| `unsupportedSpec` | Present when the catalog declares a version this release does not check; nothing was checked |
| `results[]` | One per checked requirement: `id`, `title`, `strength`, `status`, `findings[]`, `link` |
| `results[].findings[]` | `at` (JSON Pointer), `line`, `message` |

`status` is `fail` (a MUST broken), `warn` (a SHOULD broken), `notice`, `n/a`,
`skipped` (needs `--fetch`) or `expected` (in the baseline).

## Process

### 1. Find where the catalog comes from

Search the repository for `ai-catalog.json`, `specVersion` and `application/ai-catalog+json`.
A built or published file usually has a source: a generator, a template, or a
static file under `public/`. Fix the source, never the build output, or the next
build undoes the fix.

### 2. Run the check

- A file in the repository: run on the file, without `--fetch`. Before a deploy,
  entries can point at artifacts that are not live yet.
- A deployed site: run on the site's URL with `--fetch`. That also checks media
  types, digests against the bytes served, and what MCP Server Cards and A2A Agent
  Cards say about themselves.

### 3. Fix failures, then warnings

Work through `results` with `status: "fail"` first. Each finding gives the place
(`line`, `at`) and what is wrong (`message`). `link` opens the spec section.
For an ID the table below does not cover, look it up in the suite's
[COVERAGE.md](https://github.com/NimbleBrainInc/ai-catalog-check/blob/main/COVERAGE.md),
which quotes the spec sentence behind it.

| ID | Fix |
|---|---|
| `unsupportedSpec` | The catalog declares a version this release does not check. If the catalog was written for a version the release does check, correct `specVersion`. If it targets a newer spec, a newer ai-catalog-check is needed; ask the user before changing the declared version |
| SVPROD-1 | `specVersion` is malformed, missing, or (with `--spec`) not the version checked: set it to the version the catalog follows, as `Major.Minor` (`"0.9"`) |
| TOP-1 | The document needs `specVersion` and an `entries` array |
| HOST-1, Level 1 | Add `host` with at least `displayName` to reach Level 2 |
| ENTRY-1, ENTRY-7 | Each entry needs `identifier`, `type`, and exactly one of `url` or `data` |
| ENTRY-4, TYPO-2 | Use `urn:air:{your-domain}:{name}:{kind}`, as in the starter below |
| ENTRY-10, ENTRY-12, ENTRY-15 | Remove `displayName`, `description` or `version` that repeat what the MCP Server Card or A2A Agent Card already says. Keep them on skill and plugin bundles, which cannot name themselves |
| DIGEST-3, INTEG-1 | `digest` is `sha256:` plus the lowercase hex SHA-256 of the exact bytes at `url`: `curl -sL <url> \| shasum -a 256` |
| MULTI-1, MULTI-2, ENTRY-16 | Entries that share an `identifier` each need a distinct `version` |
| STABLE-1, EXTKEY-2 | Move custom fields into `extensions`, under a reverse-DNS key such as `com.example` |
| LOC-1, ENTRY-8 | Serve each URL with the media type the catalog declares; the fix is in the server or CDN config |
| SIG-\*, JWS-\*, DIDWEB-\*, DIDALG-\* | Re-sign with the tool that produced the signature; never hand-edit a `jws` |

Re-run after each round of fixes. Stop when the verdict is Level 2 (or Level 1 for
a catalog with no host), then take the `warn` results to the user: they break a
SHOULD, and the user decides which to fix.

### 4. Verify the live copy

After the fix deploys, run on the site with `--fetch`. A failure there that the
file did not show is a serving problem (media type, a stale CDN, a missing artifact).

### 5. Offer CI

Add the check to the repository's CI so the catalog stays conformant:

```yaml
- uses: NimbleBrainInc/ai-catalog-check@v0.1.2
  with:
    catalogs: dist/.well-known/ai-catalog.json   # the built catalog
```

For the live site, a scheduled workflow with `catalogs: https://<site>` and
`fetch: true`. Pin the action to a tag or commit SHA.

## Starting a catalog

A Level 2 catalog for a site that offers one MCP server and one skill bundle:

```json
{
  "specVersion": "0.9",
  "host": {
    "displayName": "Example Co",
    "identifier": "example.com",
    "documentationUrl": "https://example.com/docs"
  },
  "entries": [
    {
      "identifier": "urn:air:example.com:weather:mcp",
      "type": "application/mcp-server-card+json",
      "url": "https://mcp.example.com/.well-known/mcp/server-card.json"
    },
    {
      "identifier": "urn:air:example.com:forecasting:skill",
      "displayName": "Forecasting",
      "description": "Turns a forecast into a plan for the day.",
      "type": "application/agent-skills+zip",
      "url": "https://example.com/skills/forecasting.zip",
      "digest": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    }
  ]
}
```

- Serve it at `/.well-known/ai-catalog.json` as `application/ai-catalog+json`, and
  add `<link rel="ai-catalog" href="/.well-known/ai-catalog.json">` to the site's pages.
- Identifiers read `urn:air:{publisher}:{name}:{kind}`: the publisher's domain, a
  stable name, and the kind last (`mcp`, `a2a`, `skill`, `plugin`, `catalog`). An app
  that falls back to the identifier for a display name shows `{name}`.
- The MCP entry has no `displayName` or `description`: its Server Card carries them.
- Replace the example digest with the real one for the bytes you serve.

## Baselines

When a failure or warning cannot be fixed yet (GitHub Pages cannot set
`application/ai-catalog+json`, for example), the user can list it in a baseline:

```yaml
expected:
  - id: LOC-1
    reason: GitHub Pages cannot set the media type
```

Pass it with `--baseline <file>` (or the action's `baseline` input). Propose an
entry only with a reason the user agrees to. The run fails when an entry stops
matching, so remove entries once the problem is fixed.

## Do not

- Edit the catalog to make a check pass without fixing what it found, such as
  deleting an entry that fails.
- Add a baseline entry the user has not agreed to.
- Change an identifier the catalog has already published without asking: other
  catalogs and installs refer to it, and the spec expects it to stay stable.
- Delete unrecognized fields to clear STABLE-1 when something reads them; move
  them into `extensions`.
- Report a catalog as valid from reading it. Run the CLI.

## References

- [ai-catalog-check README](https://github.com/NimbleBrainInc/ai-catalog-check#readme): options, report format, levels, CI
- [COVERAGE.md](https://github.com/NimbleBrainInc/ai-catalog-check/blob/main/COVERAGE.md): every requirement by ID, with the spec sentence
- [AI Catalog specification](https://ai-catalog.io/spec/)
