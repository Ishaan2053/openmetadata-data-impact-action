# OpenMetadata Data Impact Analysis Action

[![CI](https://github.com/Ishaan2053/openmetadata-github-action/actions/workflows/ci.yml/badge.svg)](https://github.com/Ishaan2053/openmetadata-github-action/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Ishaan2053/openmetadata-github-action/actions/workflows/codeql.yml/badge.svg)](https://github.com/Ishaan2053/openmetadata-github-action/actions/workflows/codeql.yml)
[![Secret Scan](https://github.com/Ishaan2053/openmetadata-github-action/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/Ishaan2053/openmetadata-github-action/actions/workflows/secret-scan.yml)
[![Release Bundle](https://github.com/Ishaan2053/openmetadata-github-action/actions/workflows/release.yml/badge.svg)](https://github.com/Ishaan2053/openmetadata-github-action/actions/workflows/release.yml)
[![Node](https://img.shields.io/badge/node-24.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](./package.json)

**Tags:** `github-action` `openmetadata` `data-lineage` `impact-analysis` `sql` `dbt` `schema` `pull-request` `data-governance` `nodejs` `typescript`

Analyze SQL/dbt/schema changes in pull requests, traverse downstream lineage from OpenMetadata, and publish a production-ready impact report to the PR and GitHub Actions job summary.

## What it does

- Detects tracked file changes from the PR diff.
- Extracts changed entities from SQL, dbt, and schema files.
- Resolves downstream lineage using documented OpenMetadata lineage endpoints (or MCP/auto mode).
- Computes risk (`low|medium|high`) using blast-radius and critical-tag rules.
- Publishes:
  - PR comment with summary + impacted assets + warnings + suggestions
  - GitHub Actions job summary with full report
- Exposes machine-readable outputs for workflow automation.

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
        uses: Ishaan2053/openmetadata-github-action@v1
        with:
          openmetadata-endpoint: ${{ secrets.OPENMETADATA_ENDPOINT }}
          auth-token: ${{ secrets.OPENMETADATA_TOKEN }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Usage examples

### 1) Standard PR analysis

```yaml
- name: Analyze impact
  uses: Ishaan2053/openmetadata-github-action@v1
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
  uses: Ishaan2053/openmetadata-github-action@v1
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
  uses: Ishaan2053/openmetadata-github-action@v1
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
| `impacted-asset-count` | Number of impacted downstream assets |
| `warning-count` | Number of warnings generated |
| `changed-entity-count` | Number of extracted changed entities |
| `low-confidence-entity-count` | Number of low-confidence extracted entities |
| `truncated-analysis` | `true` if guardrails truncated analysis |
| `analysis-status` | Overall run status (`success`, `partial`, `degraded`, `skipped`, `failed`) |
| `warning-code-counts` | JSON object mapping warning taxonomy codes to counts |
| `impact-json` | Compact machine-readable JSON payload for automation |
| `impact-json-file` | Path to full JSON payload when `impact-json-file` input is configured |

### Output usage example

```yaml
- name: Analyze impact
  id: impact
  uses: Ishaan2053/openmetadata-github-action@v1
  with:
    openmetadata-endpoint: ${{ secrets.OPENMETADATA_ENDPOINT }}
    auth-token: ${{ secrets.OPENMETADATA_TOKEN }}
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Block risky PRs
  if: steps.impact.outputs.risk-level == 'high'
  run: |
    echo "High-risk data impact detected"
    exit 1
```

## Inputs (configurable options)

| Input | Required | Default | Description |
|---|---:|---|---|
| `openmetadata-endpoint` | yes | - | OpenMetadata API base URL |
| `auth-token` | yes | - | OpenMetadata bearer token |
| `github-token` | no | `${{ github.token }}` / `GITHUB_TOKEN` | GitHub token for diff reading + PR comments |
| `file-patterns` | no | See defaults in `action.yml` | Comma/newline glob patterns for tracked files |
| `lineage-provider` | no | `auto` | `api`, `mcp`, or `auto` |
| `mcp-endpoint` | no | - | Optional HTTP endpoint for MCP lineage adapter |
| `max-lineage-depth` | no | `3` | Maximum downstream traversal depth (1-3; OpenMetadata API limit) |
| `max-concurrency` | no | `4` | Max concurrent lineage lookups |
| `max-tracked-files` | no | `200` | Max tracked files analyzed per PR |
| `max-entities` | no | `500` | Max extracted entities analyzed |
| `max-downstream-assets` | no | `2000` | Max downstream assets before truncation |
| `request-timeout-ms` | no | `15000` | HTTP timeout in ms |
| `max-retries` | no | `3` | Max retries for transient API errors (`0` disables retries) |
| `fail-on-missing-metadata` | no | `false` | Fail run if referenced entities are missing in metadata |
| `ai-summary-enabled` | no | `false` | Enable optional AI summary layer |
| `ai-summary-endpoint` | no | - | Optional endpoint for external AI summary |
| `impact-json-file` | no | - | Optional path to write full JSON payload (for artifact upload) |
| `strict-sql-parse` | no | `false` | Stricter SQL parsing mode |
| `critical-asset-tags` | no | `tier1,critical,business_critical` | Critical tags that increase risk |
| `risk-high-dashboard-count` | no | `5` | High-risk threshold for impacted dashboards |
| `risk-high-pipeline-count` | no | `4` | High-risk threshold for impacted pipelines |
| `risk-high-report-count` | no | `8` | High-risk threshold for impacted reports |
| `risk-high-total-assets` | no | `20` | High-risk threshold for total impacted assets |
| `risk-high-warning-count` | no | `3` | Warning count threshold that can escalate to high risk |
| `risk-high-warning-min-assets` | no | `8` | Minimum impacted assets when warning threshold is met |
| `risk-high-low-confidence-count` | no | `10` | High-risk threshold for low-confidence extracted entities |
| `allowed-endpoint-hosts` | no | - | Optional endpoint hostname allowlist |
| `allow-insecure-local-endpoints` | no | `false` | Allow `http://` for localhost/loopback only |
| `max-comment-assets` | no | `20` | Max impacted assets shown per type in PR comment |

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
- Warning strings are taxonomy-prefixed (for example, `[METADATA_MISSING]`, `[RATE_LIMITED]`, `[NETWORK_ERROR]`, `[COMMENT_PUBLISH_FAILED]`).
- `impact-json` provides a compact structured payload suitable for follow-up workflow steps.
- If `impact-json-file` is configured, the action writes a full payload to disk and sets `impact-json-file` output.

Example artifact upload:

```yaml
- name: Analyze impact
  id: impact
  uses: Ishaan2053/openmetadata-github-action@v1
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
- Guardrails for oversized PRs/graphs (`max-tracked-files`, `max-entities`, `max-downstream-assets`).
- Idempotent PR comment upsert with marker-based ownership checks.

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

## Notes

- This action is optimized for pull request workflows.
- `lineage-provider: auto` uses MCP when configured and falls back to OpenMetadata API.
