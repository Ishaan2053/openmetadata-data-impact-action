Note: This README is production-oriented. For the hackathon-focused overview, judges please see [HACKATHON_SUMMARY.md](./HACKATHON_SUMMARY.md)

# OpenMetadata Data Impact Analysis Action

[![CI](https://github.com/Ishaan2053/openmetadata-data-impact-action/actions/workflows/ci.yml/badge.svg)](https://github.com/Ishaan2053/openmetadata-data-impact-action/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Ishaan2053/openmetadata-data-impact-action/actions/workflows/codeql.yml/badge.svg)](https://github.com/Ishaan2053/openmetadata-data-impact-action/actions/workflows/codeql.yml)
[![Integration: OpenMetadata](https://github.com/Ishaan2053/openmetadata-data-impact-action/actions/workflows/integration-openmetadata.yml/badge.svg)](https://github.com/Ishaan2053/openmetadata-data-impact-action/actions/workflows/integration-openmetadata.yml)
[![Secret Scan](https://github.com/Ishaan2053/openmetadata-data-impact-action/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/Ishaan2053/openmetadata-data-impact-action/actions/workflows/secret-scan.yml)
[![Release](https://github.com/Ishaan2053/openmetadata-data-impact-action/actions/workflows/release.yml/badge.svg)](https://github.com/Ishaan2053/openmetadata-data-impact-action/actions/workflows/release.yml)
[![Node](https://img.shields.io/badge/node-24.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](./package.json)


Analyze SQL, dbt model, and dbt YAML property changes in pull requests, traverse downstream lineage from OpenMetadata, and publish a production-ready impact report to the PR and GitHub Actions job summary.

## What it does

- Detects tracked file changes from the PR diff.
- Extracts changed entities from SQL, dbt model SQL, and dbt YAML/property files.
- Resolves downstream lineage using documented OpenMetadata lineage endpoints (or MCP/auto mode).
- Uses official OpenMetadata MCP JSON-RPC (`initialize`, `tools/list`, `tools/call`) with `get_entity_lineage`, `search_metadata`, and `get_entity_details` when MCP mode is enabled.
- Computes risk (`low|medium|high`) using blast-radius, critical-tag rules, and OpenMetadata governance context such as owners and domains.
- Publishes:
  - PR comment with summary + impacted assets + warnings + suggestions
  - GitHub Actions job summary with full report
- Exposes machine-readable outputs for workflow automation.

## OpenMetadata compatibility matrix

The lineage parser is contract-tested against the following OpenMetadata lineage payload styles:

| Compatibility target | Payload style covered | Test source |
|---|---|---|
| `1.5.x` | `downstreamNodes` array responses | `test/openmetadata-compatibility-matrix.test.js` |
| `1.6.x` | `nodes` + `downstreamEdges` (node-id references) | `test/openmetadata-compatibility-matrix.test.js` |
| `1.7+` | `downstreamEdges` with inline `toEntity` objects | `test/openmetadata-compatibility-matrix.test.js` |

If your deployment returns a new lineage response shape, add a matrix case first and then extend parser support.

## Quick start

```yaml
name: Data Impact Analysis

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  analyze-impact:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Run OpenMetadata impact analysis
        uses: Ishaan2053/openmetadata-data-impact-action@v1
        with:
          openmetadata-endpoint: ${{ secrets.OPENMETADATA_ENDPOINT }}
          auth-token: ${{ secrets.OPENMETADATA_TOKEN }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          operating-mode: balanced
```

### Quickstart presets

- `fast`: lower traversal depth and retry pressure for quick feedback on large PRs.
- `balanced`: default production-safe behavior.
- `strict-governance`: stronger parsing + metadata enforcement for regulated environments.

Example:

```yaml
- name: Analyze impact (strict governance preset)
  uses: Ishaan2053/openmetadata-data-impact-action@v1
  with:
    openmetadata-endpoint: ${{ secrets.OPENMETADATA_ENDPOINT }}
    auth-token: ${{ secrets.OPENMETADATA_TOKEN }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    operating-mode: strict-governance
```

## Usage examples

### 1) Standard PR analysis

```yaml
- name: Analyze impact
  uses: Ishaan2053/openmetadata-data-impact-action@v1
  with:
    openmetadata-endpoint: ${{ secrets.OPENMETADATA_ENDPOINT }}
    auth-token: ${{ secrets.OPENMETADATA_TOKEN }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    lineage-provider: auto
    max-lineage-depth: "3"
```

### 2) Strict mode with hard-fail on missing metadata

```yaml
- name: Analyze impact (strict)
  uses: Ishaan2053/openmetadata-data-impact-action@v1
  with:
    openmetadata-endpoint: ${{ secrets.OPENMETADATA_ENDPOINT }}
    auth-token: ${{ secrets.OPENMETADATA_TOKEN }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    strict-sql-parse: "true"
    fail-on-missing-metadata: "true"
    max-lineage-depth: "3"
```

### 3) Host allowlist and critical tags

```yaml
- name: Analyze impact (hardened)
  uses: Ishaan2053/openmetadata-data-impact-action@v1
  with:
    openmetadata-endpoint: https://metadata.example.com
    auth-token: ${{ secrets.OPENMETADATA_TOKEN }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    allowed-endpoint-hosts: |
      metadata.example.com
      ai.example.com
    critical-asset-tags: |
      tier1
      revenue_critical
```

## Outputs

The action exposes the following outputs:

| Output | Description |
|---|---|
| `risk-level` | Computed risk level (`high`, `medium`, `low`) |
| `impacted-asset-count` | Total impacted downstream assets |
| `warning-count` | Number of warnings generated during analysis |
| `changed-entity-count` | Number of changed entities extracted from PR files |
| `low-confidence-entity-count` | Number of low confidence extracted entities |
| `truncated-analysis` | Whether analysis was truncated by guardrails (`true` or `false`) |
| `analysis-status` | Overall analysis state (`success`, `partial`, `degraded`, `skipped`, `failed`) |
| `warning-code-counts` | JSON object mapping warning taxonomy code to occurrence count |
| `retry-observability` | JSON object with retry counters (attempts, capped waits, budget exhaustions) |
| `impact-json` | Compact structured impact JSON for workflow automation |
| `impact-json-file` | Resolved path to full structured JSON file when `impact-json-file` input is set |

### Output usage example

```yaml
- name: Analyze impact
  id: impact
  uses: Ishaan2053/openmetadata-data-impact-action@v1
  with:
    openmetadata-endpoint: ${{ secrets.OPENMETADATA_ENDPOINT }}
    auth-token: ${{ secrets.OPENMETADATA_TOKEN }}
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Block risky PRs
  if: steps.impact.outputs.analysis-status != 'success' || steps.impact.outputs.risk-level == 'high'
  run: |
    echo "Impact analysis failed or high-risk data impact detected"
    exit 1
```

`analysis-status` should be treated as the primary workflow contract. On `failed`, the action fail-closes by setting `risk-level` to `high`.

## Inputs (configurable options)

| Input | Required | Default | Description |
|---|---:|---|---|
| `openmetadata-endpoint` | yes | - | OpenMetadata API base URL (for example, `https://metadata.example.com`) |
| `auth-token` | yes | - | OpenMetadata bearer token |
| `github-token` | no | `${{ github.token }}` / `GITHUB_TOKEN` | GitHub token used to read PR diff and publish comments |
| `file-patterns` | no | `**/*.sql`, `**/models/**/*.yml`, `**/models/**/*.yaml`, `**/schema.yml`, `**/schema.yaml`, `**/dbt_project.yml`, `**/dbt_project.yaml` | Comma or newline separated glob patterns for tracked files |
| `operating-mode` | no | `balanced` | Preset execution mode (`fast`, `balanced`, `strict-governance`) |
| `lineage-provider` | no | `auto` | Lineage backend (`api`, `mcp`, or `auto`) |
| `mcp-endpoint` | no | - | OpenMetadata MCP JSON-RPC endpoint (defaults to `{openmetadata-endpoint}/mcp`) |
| `max-lineage-depth` | no | `3` | Maximum downstream traversal depth (1-3, OpenMetadata API limit) |
| `max-concurrency` | no | `4` | Maximum concurrent lineage lookups |
| `max-tracked-files` | no | `200` | Maximum tracked files analyzed per PR |
| `max-entities` | no | `500` | Maximum extracted entities analyzed per PR |
| `max-downstream-assets` | no | `2000` | Maximum downstream assets traversed before truncation |
| `request-timeout-ms` | no | `15000` | HTTP request timeout in milliseconds |
| `max-retries` | no | `3` | Maximum retries for transient API failures (`0` disables retries) |
| `max-retry-wait-ms` | no | `15000` | Maximum wait duration per retry attempt in milliseconds |
| `max-total-retry-wait-ms` | no | `60000` | Total retry wait budget across a single lineage request in milliseconds |
| `fail-on-missing-metadata` | no | `false` | Fail action if referenced entities cannot be resolved in metadata |
| `ai-summary-enabled` | no | `false` | Enable optional AI summary layer |
| `ai-summary-provider` | no | - | LLM provider for AI summary (for example, `openai`, `anthropic`, `google`, `openrouter`) |
| `ai-summary-model` | no | - | LLM model name for AI summary (for example, `gpt-4-mini`, `claude-3-5-sonnet-latest`) |
| `ai-summary-api-key` | no | - | API key for selected AI summary LLM provider (store in GitHub Secrets) |
| `impact-json-file` | no | - | Optional path to write full structured impact JSON (for artifact upload) |
| `strict-sql-parse` | no | `false` | Use stricter SQL parsing mode for higher precision |
| `critical-asset-tags` | no | `tier1`, `critical`, `business_critical` | Comma or newline separated critical asset tags for risk scoring |
| `risk-high-dashboard-count` | no | `5` | Dashboard impact count threshold for high risk |
| `risk-high-pipeline-count` | no | `4` | Pipeline impact count threshold for high risk |
| `risk-high-report-count` | no | `8` | Report impact count threshold for high risk |
| `risk-high-total-assets` | no | `20` | Total impacted assets threshold for high risk |
| `risk-high-warning-count` | no | `3` | Warning count threshold that can trigger high risk with sufficient impacted assets |
| `risk-high-warning-min-assets` | no | `8` | Minimum impacted assets required when warning threshold is met for high risk |
| `risk-high-low-confidence-count` | no | `10` | Low-confidence changed entity threshold for high risk |
| `risk-weight-governance` | no | `0` | Optional governance weight used in weighted risk scoring overlay |
| `risk-weight-usage` | no | `0` | Optional usage weight used in weighted risk scoring overlay |
| `risk-weight-data-quality` | no | `0` | Optional data-quality weight used in weighted risk scoring overlay |
| `risk-weight-medium-threshold` | no | `6` | Weighted risk score threshold that lifts low risk to medium |
| `risk-weight-high-threshold` | no | `12` | Weighted risk score threshold that escalates risk to high |
| `allowed-endpoint-hosts` | no | - | Optional comma or newline separated endpoint hostname allowlist |
| `allow-insecure-local-endpoints` | no | `false` | Allow http endpoints for localhost or loopback only |
| `max-comment-assets` | no | `20` | Maximum impacted assets shown per type in PR comment |

## Environment variables

The action supports/uses these environment variables:

| Variable | Required | Default | Scope | Description |
|---|---:|---|---|---|
| `GITHUB_TOKEN` | no* | - | Action runtime | Fallback token when `github-token` input is not provided |
| `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` | no | `true` (recommended) | Workflow/job | Forces Node 24 runtime for JS actions in workflow |
| `ACTIONS_STEP_DEBUG` | no | `false` | Workflow/repo setting | Enables verbose debug logs in Actions output |

\* Required if `github-token` input is omitted.

## Output format (what you get)

### PR comment (markdown)

- Summary (`risk`, entity counts, impacted asset counts, warnings)
- What Changed section from diff hunks
- Impacted assets grouped by type
- Warnings + suggestions

### Job summary (markdown)

- Full impact report written to Actions job summary for quick triage.
- When report content exceeds GitHub step summary size limits, the summary is truncated with a notice and full details remain in PR comment + outputs.

### Machine outputs

- `analysis-status` and `warning-code-counts` provide stable automation signals.
- Warning strings are taxonomy-prefixed (for example, `[METADATA_MISSING]`, `[RATE_LIMITED]`, `[NETWORK_ERROR]`, `[COMMENT_PUBLISH_FAILED]`, `[RETRY_BUDGET_EXHAUSTED]`).
- `retry-observability` exposes per-run retry counters for SLO and tuning workflows.
- `impact-json` provides a compact structured payload suitable for follow-up workflow steps.
- If `impact-json` would exceed GitHub output limits, it is automatically size-bounded and marked with `outputTruncated: true`.
- If `impact-json-file` is configured, the action writes a full payload to disk and sets `impact-json-file` output.

Example artifact upload:

```yaml
- name: Analyze impact
  id: impact
  uses: Ishaan2053/openmetadata-data-impact-action@v1
  with:
    openmetadata-endpoint: ${{ secrets.OPENMETADATA_ENDPOINT }}
    auth-token: ${{ secrets.OPENMETADATA_TOKEN }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    impact-json-file: .artifacts/impact-analysis.json

- name: Upload impact JSON artifact
  if: steps.impact.outputs.impact-json-file != ''
  uses: actions/upload-artifact@v4
  with:
    name: impact-analysis
    path: ${{ steps.impact.outputs.impact-json-file }}
```

## Security and operational behavior

- Endpoint validation (`https` by default; optional localhost HTTP escape hatch).
- Optional endpoint host allowlist.
- Retry/backoff + `Retry-After` support for transient failures.
- Retry safeguard controls: capped per-attempt wait and total retry wait budget per request.
- Guardrails for oversized PRs/graphs (`max-tracked-files`, `max-entities`, `max-downstream-assets`).
- Idempotent PR comment upsert using a stable action marker comment.
- Fail-safe workflow contract: failed analysis reports `analysis-status=failed` and `risk-level=high`.

## Permissions

Minimum permissions for typical PR usage:

```yaml
permissions:
  contents: read
  pull-requests: write
```

## Local development

```bash
npm ci
npm run check
```

`npm run check` executes lint, typecheck, security audit, coverage-enforced tests, and bundle build.

For full local environment setup (OpenMetadata services, self-hosted runner, private-repo action access, and end-to-end PR testing), see [`LOCAL_DEVELOPMENT.md`](./LOCAL_DEVELOPMENT.md).


## Notes

- This action is optimized for pull request workflows.
- `lineage-provider: auto` uses official OpenMetadata MCP first and falls back to OpenMetadata API, sticking to API fallback for the rest of the run when MCP is clearly unavailable.
- This Action uses [multi-llm-ts](https://nbonamy.github.io/multi-llm-ts/) for unified LLM provider integration in the optional AI summary layer. See all available providers [here](https://nbonamy.github.io/multi-llm-ts/guide/providers.html).


---

Built during Back to the Metadata Hackathon with 💪🏼. For the hackathon-focused overview, judges please see [HACKATHON_SUMMARY.md](./HACKATHON_SUMMARY.md)
