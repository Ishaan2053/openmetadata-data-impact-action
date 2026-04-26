# OpenMetadata Data Impact Action (Hackathon Overview)
We know going through tons of submissions is a real cognitive drain, so We put together a no-fluff readme for you guys so it's easy to understand what all we've done in less than 2 minutes (our production [README.md](https://github.com/Ishaan2053/openmetadata-data-impact-action/blob/main/README.md) is too much lol).

Project submission video [here](https://youtu.be/iVBs-KyPHCE).
Demo repository with the action in use [here](https://github.com/ishaan2053/om-impact-demo)

---

### 1) What problem are we solving?
Data teams merge SQL/dbt changes without clear visibility into downstream impact.

A single schema or model change can silently break dashboards, reports, and pipelines.

This project is based on this [GitHub issue](https://github.com/open-metadata/OpenMetadata/issues/26648).

### 2) What is our solution?
We built a GitHub Action that analyzes pull requests, uses OpenMetadata lineage, and posts an impact report directly in the PR as a comment.

### 3) Why does it matter?
It prevents production incidents before merge by showing blast radius and risks early.

This reduces:
- Broken dashboards
- Failed pipelines
- Incident response time
- Unplanned data downtime

### 4) What makes it practical
- Takes less than 1 minute to set up :)
- Works in normal pull request workflows
- Produces both human-readable and machine-readable outputs
- Supports production controls (retry handling, guardrails, strict governance mode)
- Integrates directly with OpenMetadata as the source of truth for lineage

### 5) Features (at a glance)
- PR diff analysis for SQL, dbt model SQL, and dbt YAML/property changes
- Entity extraction with optional strict SQL mode + low-confidence tracking
- OpenMetadata lineage via API, MCP, or auto mode (with MCP tools support)
- Risk classification (low/medium/high) using blast radius, warnings, critical tags, governance context, and configurable thresholds/weights
- Operating presets: `fast`, `balanced`, `strict-governance`
- Guardrails: max tracked files, entities, downstream assets, and truncation-safe reporting
- Reliability controls: retries with jitter, `Retry-After`, per-attempt wait caps, and total retry budget caps
- Security controls: endpoint allowlist, localhost-only insecure mode, markdown/comment sanitization, and safe link handling
- Outputs: idempotent PR comment upsert, full GitHub job summary, compact `impact-json`, optional `impact-json-file`, and workflow outputs (`analysis-status`, `risk-level`, counts, warning taxonomy, retry observability)
- Optional AI-generated summary layer
- OpenMetadata lineage compatibility coverage across multiple payload shapes (1.5.x, 1.6.x, 1.7+)

---

## Snapshots

### A) High-level execution flow

<img width="2530" height="872" alt="image" src="https://github.com/user-attachments/assets/8708690e-ea74-4948-9750-abe29e56d86e" />


### B) Available configuration options for the Action

<img width="2501" height="908" alt="image" src="https://github.com/user-attachments/assets/46cb97df-9077-4173-81dd-87959eb758ed" />


### C) Different possible runtime outputs

<img width="2462" height="1077" alt="image" src="https://github.com/user-attachments/assets/3688e849-e4b9-49d4-ba25-6e2127fe69cc" />


---

## Some FAQs

### Why this tech stack?
- GitHub Action: The problem happens in pull requests, so running directly in CI gives immediate feedback where decisions are made.
- TypeScript + Node: Strong typing and modern runtime support make the action safer and easier to maintain in production.
- GitHub Actions natively run on Node.js, so using TS/JS avoids extra dependencies or wrappers. On top of that, it is cross platform.
- OpenMetadata already stores lineage, ownership, and governance context; we reuse that source of truth instead of rebuilding metadata systems.

### Why is this a separate repository?
Well, the original [GitHub issue](https://github.com/open-metadata/OpenMetadata/issues/26648) for this problem statement referenced what was already cooking in the [ai-sdk](https://github.com/open-metadata/ai-sdk/) repository. However, we thought to build this in a separate repository because: - 
- It is packaged as a reusable GitHub Action, so it needs its own release lifecycle, versioning, CI, and bundle artifact.
- Multiple data teams or repositories can consume the same action without duplicating logic.
- This still draws heavily from the groundwork present in that repository while adding features on top of it. 

### Why not build this as an internal script in each repo?
- Repo-local scripts drift quickly and create inconsistent risk logic.
- A reusable action gives one contract (`analysis-status`, `risk-level`, `impact-json`) that all teams can standardize on.
- Centralized fixes and improvements become instantly reusable across all adopters.

### How does OpenMetadata specifically improve results vs static SQL parsing alone?
- Static parsing identifies what changed; OpenMetadata identifies who and what is downstream.
- The action can classify impact by real asset types (dashboards, pipelines, reports) and not just table names.
- Governance metadata (tags, owners, domains) improves prioritization and escalation quality.

### How is this production-oriented and not just a demo?
- Guardrails for large PRs and graph size.
- Retry controls with capped wait and total retry budget.
- Idempotent PR comment upsert to avoid comment spam.
- Machine-readable outputs for policy gates and automation.
- Compatibility tests across OpenMetadata lineage payload variants.
- The action has it's own CI, plus bundling + tests + lint :)

### Guys, where's the branding? 
- Yeah we know comments are posted by the github-actions. There's a _stupid_ catch to posting comments as the OpenMetadata-bot itself. 
- It's possible to add branding by creating a GitHub App and then passing its token in the action instead of having the `GITHUB.TOKEN` be fed to it.
- However, that'd require consumers to install that app on their Orgs/repos. All that for branding? Well, we could get around to having it set up, but then it's a non-blocking enhancement anyways we can add on later.

### What would be the next step after the hackathon?
- Since we've now put time an effort into building it, would really love to have it be part of the offiial community and become useful for people.
- There's always room for improvements; **we don't plan to abandon this.**

--- 

### _⭐ Built during Back to the Metadata Hackathon by WeMakeDevs ⭐_

This was not written by AI but by two living, breathing nerds, so thank you for taking the time out to read this!
