import { ActionConfig, AssetType, CanonicalEntity, LineageNode, LineageResult } from "../types";
import { logDebug, logWarning } from "../logging";
import { formatWarning, WarningCode } from "../warnings";
import { LineageProvider } from "./provider";

interface RequestResult {
  ok: boolean;
  status: number;
  bodyText: string;
  headers?: Headers;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(base: number): number {
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const asSeconds = Number.parseInt(value, 10);
  if (!Number.isNaN(asSeconds) && asSeconds >= 0) {
    return asSeconds * 1000;
  }

  const asDate = Date.parse(value);
  if (Number.isNaN(asDate)) {
    return undefined;
  }

  const diff = asDate - Date.now();
  return diff > 0 ? diff : undefined;
}

function normalizeType(value: string | undefined): AssetType {
  const lower = (value ?? "").toLowerCase();
  if (lower.includes("dashboard")) {
    return "dashboard";
  }
  if (lower.includes("pipeline")) {
    return "pipeline";
  }
  if (lower.includes("report")) {
    return "report";
  }
  if (lower.includes("view")) {
    return "view";
  }
  if (lower.includes("table")) {
    return "table";
  }
  if (lower.includes("topic")) {
    return "topic";
  }
  return "other";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readEntityName(input: unknown): string | undefined {
  if (typeof input === "string") {
    return input;
  }

  if (!input || typeof input !== "object") {
    return undefined;
  }

  const obj = input as Record<string, unknown>;
  return (
    asString(obj.fullyQualifiedName) ??
    asString(obj.displayName) ??
    asString(obj.name)
  );
}

function normalizeList(values: string[]): string[] | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

function readNode(input: unknown): LineageNode | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const item = input as Record<string, unknown>;
  const idRaw = item.id ?? item.entityId ?? item.fullyQualifiedName ?? item.fqn ?? item.name;
  const fqnRaw = item.fullyQualifiedName ?? item.fqn ?? item.name;
  const nameRaw = item.displayName ?? item.name ?? fqnRaw;

  if (typeof idRaw !== "string" || typeof fqnRaw !== "string" || typeof nameRaw !== "string") {
    return undefined;
  }

  const typeRaw = item.type ?? item.entityType;
  const urlRaw = item.href ?? item.url;
  const tagsRaw = item.tags;
  const ownersRaw = item.owners ?? item.owner;
  const glossaryRaw = item.glossaryTerms;
  const domainRaw = item.domain;

  const tags: string[] = [];
  if (Array.isArray(tagsRaw)) {
    for (const tag of tagsRaw) {
      if (typeof tag === "string") {
        tags.push(tag.toLowerCase());
        continue;
      }

      if (tag && typeof tag === "object") {
        const tagObj = tag as Record<string, unknown>;
        const candidate =
          (typeof tagObj.tagFQN === "string" && tagObj.tagFQN) ||
          (typeof tagObj.fullyQualifiedName === "string" && tagObj.fullyQualifiedName) ||
          (typeof tagObj.name === "string" && tagObj.name);
        if (candidate) {
          tags.push(candidate.toLowerCase());
        }
      }
    }
  }

  const owners: string[] = [];
  const ownerCandidates = Array.isArray(ownersRaw)
    ? ownersRaw
    : ownersRaw
      ? [ownersRaw]
      : [];
  for (const owner of ownerCandidates) {
    const candidate = readEntityName(owner);
    if (candidate) {
      owners.push(candidate);
    }
  }

  const glossaryTerms: string[] = [];
  if (Array.isArray(glossaryRaw)) {
    for (const term of glossaryRaw) {
      const candidate = readEntityName(term);
      if (candidate) {
        glossaryTerms.push(candidate);
      }
    }
  }

  const domain = readEntityName(domainRaw);

  return {
    id: idRaw,
    fqn: fqnRaw,
    name: nameRaw,
    type: normalizeType(typeof typeRaw === "string" ? typeRaw : undefined),
    url: typeof urlRaw === "string" ? urlRaw : undefined,
    tags: normalizeList(tags),
    owners: normalizeList(owners),
    domain: domain?.toLowerCase(),
    glossaryTerms: normalizeList(glossaryTerms),
  };
}

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function buildFqnCandidates(entity: CanonicalEntity): string[] {
  const candidates = new Set<string>();
  candidates.add(entity.fqn);
  candidates.add([entity.database, entity.schema, entity.table].filter(Boolean).join("."));
  candidates.add([entity.schema, entity.table].filter(Boolean).join("."));
  candidates.add(entity.table);
  return [...candidates].filter((candidate) => candidate.length > 0);
}

function buildLineageEndpoints(base: string, fqn: string, depth: number): string[] {
  const encoded = encodeURIComponent(fqn);
  return [
    `${base}/api/v1/lineage/table/name/${encoded}?upstreamDepth=0&downstreamDepth=${depth}`,
  ];
}

function warningCodeForStatus(status: number): WarningCode {
  if (status === 401 || status === 403) {
    return "AUTH_ERROR";
  }
  if (status === 429) {
    return "RATE_LIMITED";
  }
  if (status === 599) {
    return "NETWORK_ERROR";
  }
  if (status >= 500) {
    return "SERVICE_UNAVAILABLE";
  }
  return "LINEAGE_REQUEST_FAILED";
}

function parseLineagePayload(payload: unknown, sourceEntityFqn: string): {
  nodes: LineageNode[];
  partial: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const nodes: LineageNode[] = [];

  if (!payload || typeof payload !== "object") {
    return {
      nodes,
      partial: true,
      warnings: [
        formatWarning("LINEAGE_EMPTY_PAYLOAD", "Lineage API returned an empty payload."),
      ],
    };
  }

  const data = payload as Record<string, unknown>;
  const nodeMap = new Map<string, LineageNode>();

  if (Array.isArray(data.nodes)) {
    for (const item of data.nodes) {
      const node = readNode(item);
      if (node) {
        nodeMap.set(node.id, node);
        nodeMap.set(node.fqn, node);
      }
    }
  }

  if (Array.isArray(data.downstreamEdges)) {
    for (const edge of data.downstreamEdges) {
      if (!edge || typeof edge !== "object") {
        continue;
      }

      const edgeObj = edge as Record<string, unknown>;
      const toEntity = edgeObj.toEntity;
      const parsedTo = readNode(toEntity);
      if (parsedTo) {
        parsedTo.upstreamFrom = sourceEntityFqn;
        nodes.push(parsedTo);
        continue;
      }

      if (typeof toEntity === "string") {
        const fromMap = nodeMap.get(toEntity);
        if (fromMap) {
          nodes.push({ ...fromMap, upstreamFrom: sourceEntityFqn });
        }
      }
    }
  }

  if (Array.isArray((data as { downstreamNodes?: unknown[] }).downstreamNodes)) {
    for (const item of (data as { downstreamNodes?: unknown[] }).downstreamNodes ?? []) {
      const parsed = readNode(item);
      if (parsed) {
        parsed.upstreamFrom = sourceEntityFqn;
        nodes.push(parsed);
      }
    }
  }

  const unique = new Map<string, LineageNode>();
  for (const node of nodes) {
    unique.set(node.fqn, node);
  }

  return {
    nodes: [...unique.values()],
    partial: warnings.length > 0,
    warnings,
  };
}

export class OpenMetadataLineageProvider implements LineageProvider {
  readonly name = "openmetadata-api";
  private readonly cache = new Map<string, Promise<LineageResult>>();

  constructor(private readonly config: ActionConfig) {}

  async getDownstream(entity: CanonicalEntity, depth: number): Promise<LineageResult> {
    const cacheKey = `${entity.fqn}|${depth}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const promise = this.getDownstreamUncached(entity, depth);
    this.cache.set(cacheKey, promise);

    try {
      return await promise;
    } catch (error) {
      this.cache.delete(cacheKey);
      throw error;
    }
  }

  private async getDownstreamUncached(entity: CanonicalEntity, depth: number): Promise<LineageResult> {
    const warnings: string[] = [];
    const candidates = buildFqnCandidates(entity);
    let sawLookupFailure = false;
    let sawNotFound = false;

    for (const candidate of candidates) {
      const endpoints = buildLineageEndpoints(this.config.openMetadataEndpoint, candidate, depth);

      for (const endpoint of endpoints) {
        const response = await this.requestWithRetry(endpoint);
        if (response.status === 404) {
          sawNotFound = true;
          logDebug(`Entity not found for candidate ${candidate} via ${endpoint}.`);
          continue;
        }

        if (!response.ok) {
          sawLookupFailure = true;
          const warning = formatWarning(
            warningCodeForStatus(response.status),
            `Lineage request failed (${response.status}) for ${candidate}.`,
          );
          warnings.push(warning);
          logWarning(warning);
          continue;
        }

        const payload = parseJsonSafely(response.bodyText);
        const parsed = parseLineagePayload(payload, entity.fqn);
        return {
          sourceEntityFqn: entity.fqn,
          nodes: parsed.nodes,
          partial: parsed.partial,
          warnings: [...warnings, ...parsed.warnings],
        };
      }
    }

    if (sawLookupFailure) {
      return {
        sourceEntityFqn: entity.fqn,
        nodes: [],
        partial: true,
        warnings: [
          ...warnings,
          formatWarning(
            "LINEAGE_UNAVAILABLE",
            `Unable to fully resolve lineage for ${entity.fqn} due to upstream request failures.`,
          ),
        ],
      };
    }

    if (sawNotFound) {
      return {
        sourceEntityFqn: entity.fqn,
        nodes: [],
        partial: true,
        warnings: [...warnings, formatWarning("METADATA_MISSING", `Missing metadata for ${entity.fqn}.`)],
      };
    }

    return {
      sourceEntityFqn: entity.fqn,
      nodes: [],
      partial: true,
      warnings: [
        ...warnings,
        formatWarning(
          "LINEAGE_UNAVAILABLE",
          `Unable to resolve lineage for ${entity.fqn}; no successful metadata lookup was observed.`,
        ),
      ],
    };
  }

  private async requestWithRetry(url: string): Promise<RequestResult> {
    let attempt = 0;
    let backoff = 300;

    while (attempt <= this.config.maxRetries) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.config.authToken}`,
            Accept: "application/json",
          },
          signal: controller.signal,
        });

        const bodyText = await response.text();
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        const shouldRetry = (response.status === 429 || response.status >= 500) && attempt <= this.config.maxRetries;

        if (shouldRetry) {
          const waitMs = jitterMs(retryAfterMs ?? backoff);
          await delay(waitMs);
          backoff *= 2;
          continue;
        }

        return {
          ok: response.ok,
          status: response.status,
          bodyText,
          headers: response.headers,
        };
      } catch (error) {
        if (attempt > this.config.maxRetries) {
          return {
            ok: false,
            status: 599,
            bodyText: String(error),
          };
        }

        await delay(jitterMs(backoff));
        backoff *= 2;
      } finally {
        clearTimeout(timer);
      }
    }

    return {
      ok: false,
      status: 599,
      bodyText: "Lineage request exhausted retries.",
    };
  }
}
