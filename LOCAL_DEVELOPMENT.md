
# Local Development Environment Setup

This guide provides a **structured, production-grade setup** for developing and testing this GitHub Action locally using real pull requests and a fully functional OpenMetadata stack.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [1. Setup Action Repository](#1-setup-action-repository)
- [2. Setup OpenMetadata Locally](#2-setup-openmetadata-locally)
- [3. Create and Validate API Token](#3-create-and-validate-api-token)
- [4. Validate Lineage Readiness](#4-validate-lineage-readiness)
- [5. Setup Self-Hosted GitHub Runner](#5-setup-self-hosted-github-runner)
- [6. Create Consumer Repository](#6-create-consumer-repository)
- [7. Configure Workflow](#7-configure-workflow)
- [8. Trigger a Test Pull Request](#8-trigger-a-test-pull-request)
- [9. Validate End-to-End Execution](#9-validate-end-to-end-execution)
- [Troubleshooting](#troubleshooting)

---

## Overview

This repository contains a GitHub Action that performs **data impact analysis using OpenMetadata** when pull requests modify data-related files (e.g., SQL, dbt models).

The guide walks through a **local-first testing approach** where:

- OpenMetadata runs locally
- A self-hosted runner executes workflows
- A separate repository simulates real PRs

---

## Architecture

The local setup consists of four components:

1. **Action Repository (this repo)**  
   Develop, lint, test, and bundle the GitHub Action.

2. **OpenMetadata Stack (local)**  
   Provides metadata APIs and lineage data.

3. **Self-Hosted GitHub Runner**  
   Executes workflows with access to `localhost`.

4. **Consumer Repository**  
   Triggers the Action via pull requests.

### Why this setup?

GitHub-hosted runners cannot access services running on your machine (`localhost`).  
Therefore, a **self-hosted runner is required** to connect to OpenMetadata (e.g., `http://localhost:8585`).

---

## Prerequisites

### Accounts & Access

- GitHub account with access to:
  - This Action repository
  - A test/consumer repository
- Ability to:
  - Add repository secrets
  - Register self-hosted runners
- Optional: GitHub CLI authenticated (`gh auth login`)

---

## Quick Start

1. Run OpenMetadata locally (Docker)
2. Register a self-hosted runner
3. Setup a consumer repo
4. Configure workflow
5. Open a PR with SQL changes
6. Validate Action output

---

## 1. Setup Action Repository

From the root of this repository:

```powershell
npm ci
npm run check
```

### What this validates

* Linting
* TypeScript checks
* Security audit
* Tests + coverage
* Bundle generation

### Important

* `action.yml` must point to `bundle/index.js`
* Re-run bundling after any runtime changes

---

## 2. Setup OpenMetadata Locally

Refer to official documentation to set up OpenMetadata:

* Development setup: [https://docs.open-metadata.org/v1.12.x/developers/contribute/development-environment-setup](https://docs.open-metadata.org/v1.12.x/developers/contribute/development-environment-setup)
* Docker quick start: [https://docs.open-metadata.org/v1.12.x/quick-start/local-docker-deployment](https://docs.open-metadata.org/v1.12.x/quick-start/local-docker-deployment)

### Example Docker Setup

```powershell
mkdir D:\openmetadata-docker
cd D:\openmetadata-docker

curl.exe -L "https://github.com/open-metadata/OpenMetadata/releases/download/1.12.5-release/docker-compose.yml" -o docker-compose.yml

docker compose -f docker-compose.yml up -d
docker ps
```

Once you're done, you should be able to access the following: -
* OpenMetadata UI: [http://localhost:8585](http://localhost:8585)
* Airflow UI: [http://localhost:8080](http://localhost:8080)

---

## 3. Create and Validate API Token

1. Generate a Personal Access Token for OpenMetadata (see [how to generate a personal access token](https://docs.open-metadata.org/v1.12.x/how-to-guides/guide-for-data-users/personal-access-token))
2. Store securely
3. Validate API access

```powershell
$token = "PASTE_OPENMETADATA_TOKEN"
$headers = @{ Authorization = "Bearer $token" }

Invoke-RestMethod -Method Get `
  -Uri "http://localhost:8585/api/v1/tables?limit=10" `
  -Headers $headers
```

### Common Failures

* `401/403` → invalid token
* Timeout → service not running. 

---

## 4. Validate Lineage Readiness

Ensure at least one table has lineage data before testing.

```powershell
$token = "PASTE_OPENMETADATA_TOKEN"
$headers = @{ Authorization = "Bearer $token" }

$tables = Invoke-RestMethod -Method Get `
  -Uri "http://localhost:8585/api/v1/tables?limit=200" `
  -Headers $headers

$allFqns = $tables.data | Select-Object -ExpandProperty fullyQualifiedName

$withDownstream = foreach ($fqn in $allFqns) {
  $enc = [System.Uri]::EscapeDataString($fqn)
  $uri = "http://localhost:8585/api/v1/lineage/table/name/{0}?upstreamDepth=0&downstreamDepth=1" -f $enc
  try {
    $res = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
    if (@($res.downstreamEdges).Count -gt 0) {
      [pscustomobject]@{ fqn = $fqn }
    }
  } catch {}
}

$withDownstream | Select-Object -First 20
```

---

## 5. Setup Self-Hosted GitHub Runner

Follow official GitHub documentation:
[https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)

### Requirements

* Runner registered in **consumer repo**
* Runner is **online**
* Runs on same machine as OpenMetadata
* Labels match workflow

### Verify

```powershell
gh api repos/<owner>/<repo>/actions/runners
```

---

## 6. Create Consumer Repository

```powershell
gh repo create om-impact-demo --private --clone
cd om-impact-demo
git checkout -b demo/fact-orders-impact

New-Item -ItemType Directory -Force -Path .github/workflows | Out-Null
New-Item -ItemType Directory -Force -Path models | Out-Null
```

### Add Secret

```powershell
gh secret set OPENMETADATA_TOKEN -b "PASTE_OPENMETADATA_TOKEN"
```

---

## 7. Configure Workflow

Create:

```
.github/workflows/data-impact-demo.yml
```

```yaml
name: Data Impact Demo

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  impact-analysis:
    runs-on: [self-hosted, Windows, x64]

    steps:
      - name: Checkout consumer repo
        uses: actions/checkout@v4

      - name: Checkout private action repo
        uses: actions/checkout@v4
        with:
          repository: Ishaan2053/openmetadata-github-action
          ref: main
          token: ${{ secrets.ACTION_REPO_PAT }}
          path: .github/actions/openmetadata-impact

      - name: Run OpenMetadata impact analysis
        id: impact
        uses: ./.github/actions/openmetadata-impact
        with:
          openmetadata-endpoint: http://localhost:8585
          allow-insecure-local-endpoints: "true"
          auth-token: ${{ secrets.OPENMETADATA_TOKEN }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          operating-mode: balanced
          lineage-provider: api
          max-lineage-depth: "3"
```

> If using private repositories, add `ACTION_REPO_PAT` with read access.

---

## 8. Trigger a Test Pull Request

Create a tracked SQL file:

```sql
SELECT
  order_id,
  customer_id,
  total
FROM sample_data.ecommerce_db.shopify.fact_orders //sample table 
WHERE total > 100;
```

Commit and push:

```powershell
git add .
git commit -m "Demo: SQL change triggering impact analysis"
git push -u origin demo/fact-orders-impact
```

Create PR:

```powershell
gh pr create \
  --base main \
  --head demo/fact-orders-impact \
  --title "Demo: Data impact analysis"
```

---

## 9. Validate End-to-End Execution

Expected behavior:

* Workflow runs on self-hosted runner
* PR diff is analyzed
* SQL file detected
* Lineage traversal executes
* PR comment posted
* Outputs generated:

  * `risk-level`
  * `impacted-asset-count`
  * `warning-count`
  * `changed-entity-count`

---

## Troubleshooting

### Job stuck at "Waiting for a runner"

* Runner not registered or offline
* Label mismatch

---

### Action repository not found

* Private repo access not enabled
* Use checkout + PAT strategy

---

### Analysis skipped

* No tracked files modified
* Add `.sql`, `.yml`, or `.yaml` change

---

### No commits between branches

* Ensure actual file diff exists

---

### Empty lineage results

* No lineage data in OpenMetadata
* Run ingestion pipelines or use lineage-rich tables

---


## Notes

* Ensure PR includes **tracked file types** (SQL/YAML)
* Ensure runner and OpenMetadata run on same host
* Prefer deterministic setups for private repositories
