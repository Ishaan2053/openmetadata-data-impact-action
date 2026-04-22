import { ActionConfig, CanonicalEntity, LineageNode, LineageResult } from "../types";
import { formatWarning } from "../warnings";
import { LineageProvider } from "./provider";

interface McpJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface McpJsonRpcResponse<T> {
  jsonrpc?: string;
  id?: number | string;
  result?: T;
  error?: McpJsonRpcError;
}

interface McpToolDefinition {
  name?: string;
}

interface McpInitializeResult {
  protocolVersion?: string;
}

interface McpToolsListResult {
  tools?: McpToolDefinition[];
}

interface McpToolContent {
  type?: string;
  text?: string;
  json?: unknown;
}

interface McpToolCallResult {
  content?: McpToolContent[];
  structuredContent?: unknown;
}

const MCP_PROTOCOL_VERSION = "2024-11-05";
const MCP_TOOL_SEARCH_METADATA = "search_metadata";
const MCP_TOOL_GET_ENTITY_DETAILS = "get_entity_details";
const MCP_TOOL_GET_ENTITY_LINEAGE = "get_entity_lineage";
const MAX_SEARCH_LIMIT = 5;
const MAX_DETAIL_LOOKUPS = 24;

function normalizeList(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  return [...new Set(values.map((value) => value.toLowerCase()))];
}

function mapType(raw: string | undefined): LineageNode["type"] {
  const lower = (raw ?? "").toLowerCase();
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

function mapNodeTypeToEntityType(type: LineageNode["type"]): string | undefined {
  if (type === "dashboard") {
    return "dashboard";
  }
  if (type === "pipeline") {
    return "pipeline";
  }
  if (type === "table" || type === "view") {
    return "table";
  }
  if (type === "topic") {
    return "topic";
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function parseJsonBlocks(text: string): unknown[] {
  const parsed: unknown[] = [];
  const blockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;

  for (const match of text.matchAll(blockRegex)) {
    const block = match[1]?.trim();
    if (!block) {
      continue;
    }

    const parsedBlock = parseJsonString(block);
    if (parsedBlock !== undefined) {
      parsed.push(parsedBlock);
    }
  }

  return parsed;
}

function tryReadTextPayloads(result: McpToolCallResult): string[] {
  const payloads: string[] = [];
  for (const item of result.content ?? []) {
    const text = asNonEmptyString(item.text);
    if (text) {
      payloads.push(text);
    }
  }
  return payloads;
}

function readStructuredCandidates(result: McpToolCallResult): unknown[] {
  const candidates: unknown[] = [];

  if (result.structuredContent !== undefined) {
    candidates.push(result.structuredContent);
  }

  for (const item of result.content ?? []) {
    if (item.json !== undefined) {
      candidates.push(item.json);
    }

    const text = asNonEmptyString(item.text);
    if (!text) {
      continue;
    }

    const parsedText = parseJsonString(text);
    if (parsedText !== undefined) {
      candidates.push(parsedText);
    }

    candidates.push(...parseJsonBlocks(text));
  }

  return candidates;
}

function readEntityName(input: unknown): string | undefined {
  if (typeof input === "string") {
    return input;
  }

  const obj = asRecord(input);
  if (!obj) {
    return undefined;
  }

  return (
    asNonEmptyString(obj.fullyQualifiedName) ??
    asNonEmptyString(obj.displayName) ??
    asNonEmptyString(obj.name)
  );
}

function readStringList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const values: string[] = [];
  for (const item of input) {
    if (typeof item === "string") {
      values.push(item);
      continue;
    }

    const candidate = readEntityName(item);
    if (candidate) {
      values.push(candidate);
    }
  }

  return values;
}

function mergeStringLists(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  const merged = [...(left ?? []), ...(right ?? [])];
  return merged.length > 0 ? [...new Set(merged)] : undefined;
}

function readNodeFromUnknown(input: unknown, upstreamFrom: string): LineageNode | undefined {
  const obj = asRecord(input);
  if (!obj) {
    return undefined;
  }

  const id =
    asNonEmptyString(obj.id) ??
    asNonEmptyString(obj.entityId) ??
    asNonEmptyString(obj.fullyQualifiedName) ??
    asNonEmptyString(obj.fqn) ??
    asNonEmptyString(obj.name);
  const fqn =
    asNonEmptyString(obj.fullyQualifiedName) ??
    asNonEmptyString(obj.fqn) ??
    asNonEmptyString(obj.name);
  const name =
    asNonEmptyString(obj.displayName) ??
    asNonEmptyString(obj.name) ??
    asNonEmptyString(obj.fullyQualifiedName) ??
    asNonEmptyString(obj.fqn);

  if (!id || !fqn || !name) {
    return undefined;
  }

  const tags = normalizeList(readStringList(obj.tags));
  const owners = normalizeList(readStringList(obj.owners ?? obj.owner));
  const glossaryTerms = normalizeList(readStringList(obj.glossaryTerms));
  const domain = readEntityName(obj.domain)?.toLowerCase();

  return {
    id,
    fqn,
    name,
    type: mapType(asNonEmptyString(obj.type) ?? asNonEmptyString(obj.entityType)),
    url: asNonEmptyString(obj.href) ?? asNonEmptyString(obj.url),
    upstreamFrom,
    tags,
    owners,
    domain,
    glossaryTerms,
  };
}

function extractNodesFromText(text: string, upstreamFrom: string): LineageNode[] {
  const nodes: LineageNode[] = [];
  const seen = new Set<string>();
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

  for (const match of text.matchAll(linkRegex)) {
    const name = match[1]?.trim();
    const url = match[2]?.trim();
    if (!name || !url) {
      continue;
    }

    let fqn: string | undefined;
    let type: LineageNode["type"] = "other";

    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      const maybeType = pathParts[pathParts.length - 2];
      const maybeFqn = pathParts[pathParts.length - 1];
      if (maybeType) {
        type = mapType(maybeType);
      }
      if (maybeFqn) {
        fqn = decodeURIComponent(maybeFqn);
      }
    } catch {
      continue;
    }

    if (!fqn || seen.has(fqn)) {
      continue;
    }

    seen.add(fqn);
    nodes.push({
      id: `${type}:${fqn}`,
      fqn,
      name,
      type,
      url,
      upstreamFrom,
    });
  }

  return nodes;
}

function normalizeEntityFqn(entity: CanonicalEntity): string {
  if (entity.column && entity.fqn.endsWith(`.${entity.column}`)) {
    return entity.fqn.slice(0, -(`.${entity.column}`).length);
  }
  return entity.fqn;
}

function createMcpWarning(status: number, method: string): string {
  const warningCode = status === 401 || status === 403 ? "AUTH_ERROR" : "MCP_REQUEST_FAILED";
  return formatWarning(
    warningCode,
    `OpenMetadata MCP request '${method}' failed with status ${status}.`,
  );
}

export class McpLineageProvider implements LineageProvider {
  readonly name = "openmetadata-mcp";
  private initialized = false;
  private readonly availableTools = new Set<string>();
  private requestId = 1;
  private readonly cache = new Map<string, Promise<LineageResult>>();
  private readonly observability = {
    requests: 0,
    initializeCalls: 0,
    toolListCalls: 0,
    toolCalls: 0,
  };

  constructor(private readonly config: ActionConfig) {}

  getObservabilityCounters(): Record<string, number> {
    return { ...this.observability };
  }

  async getDownstream(entity: CanonicalEntity, depth: number): Promise<LineageResult> {
    const cacheKey = `${entity.fqn}|${depth}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const request = this.getDownstreamUncached(entity, depth);
    this.cache.set(cacheKey, request);

    try {
      return await request;
    } catch (error) {
      this.cache.delete(cacheKey);
      throw error;
    }
  }

  private async getDownstreamUncached(entity: CanonicalEntity, depth: number): Promise<LineageResult> {
    if (!this.config.mcpEndpoint) {
      return {
        sourceEntityFqn: entity.fqn,
        nodes: [],
        partial: true,
        warnings: [
          formatWarning(
            "MCP_NOT_CONFIGURED",
            "MCP lineage provider selected, but mcp-endpoint is not configured.",
          ),
        ],
      };
    }

    const warnings: string[] = [];
    let partial = false;

    const initialized = await this.initializeSession(warnings);
    if (!initialized) {
      partial = true;
    }

    if (initialized && !this.availableTools.has(MCP_TOOL_GET_ENTITY_LINEAGE)) {
      warnings.push(
        formatWarning(
          "MCP_PROVIDER_WARNING",
          `OpenMetadata MCP server does not expose required tool '${MCP_TOOL_GET_ENTITY_LINEAGE}'.`,
        ),
      );
      return {
        sourceEntityFqn: entity.fqn,
        nodes: [],
        partial: true,
        warnings,
      };
    }

    const normalizedFqn = normalizeEntityFqn(entity);
    let nodes: LineageNode[] = [];

    const lineageResult = await this.callTool(
      MCP_TOOL_GET_ENTITY_LINEAGE,
      {
        entity_type: "table",
        fqn: normalizedFqn,
        upstream_depth: 0,
        downstream_depth: depth,
      },
      warnings,
    );

    if (lineageResult) {
      nodes = this.extractLineageNodes(lineageResult, entity.fqn);
      if (nodes.length === 0) {
        const textPayload = tryReadTextPayloads(lineageResult).join("\n").toLowerCase();
        const indicatesNoDownstream =
          textPayload.includes("no downstream") ||
          textPayload.includes("no affected assets") ||
          textPayload.includes("no impacted assets");

        if (!indicatesNoDownstream && textPayload.length > 0) {
          warnings.push(
            formatWarning(
              "MCP_PROVIDER_WARNING",
              "MCP lineage tool returned content but no parseable downstream nodes.",
            ),
          );
          partial = true;
        }
      }
    } else {
      partial = true;
    }

    if (nodes.length === 0 && initialized && this.availableTools.has(MCP_TOOL_SEARCH_METADATA)) {
      const discoveredFqn = await this.discoverEntityFqn(entity, warnings);
      if (discoveredFqn && discoveredFqn !== normalizedFqn) {
        const secondAttempt = await this.callTool(
          MCP_TOOL_GET_ENTITY_LINEAGE,
          {
            entity_type: "table",
            fqn: discoveredFqn,
            upstream_depth: 0,
            downstream_depth: depth,
          },
          warnings,
        );
        if (secondAttempt) {
          nodes = this.extractLineageNodes(secondAttempt, entity.fqn);
        }
      }
    }

    await this.enrichNodesWithEntityDetails(nodes, warnings);

    return {
      sourceEntityFqn: entity.fqn,
      nodes,
      partial,
      warnings: [...new Set(warnings)],
    };
  }

  private async initializeSession(warnings: string[]): Promise<boolean> {
    if (this.initialized) {
      return true;
    }

    this.observability.initializeCalls += 1;
    const init = await this.callJsonRpc<McpInitializeResult>("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {},
        prompts: {},
        resources: {
          subscribe: false,
          listChanged: false,
        },
      },
      clientInfo: {
        name: "openmetadata-data-impact-action",
        version: "1.0.0",
      },
    });

    if (!init.ok) {
      warnings.push(init.warning);
      return false;
    }

    if (init.result.protocolVersion && init.result.protocolVersion !== MCP_PROTOCOL_VERSION) {
      warnings.push(
        formatWarning(
          "MCP_PROVIDER_WARNING",
          `MCP protocol version mismatch. Client=${MCP_PROTOCOL_VERSION}, server=${init.result.protocolVersion}.`,
        ),
      );
    }

    this.observability.toolListCalls += 1;
    const tools = await this.callJsonRpc<McpToolsListResult>("tools/list");
    if (!tools.ok) {
      warnings.push(tools.warning);
      return false;
    }

    for (const tool of tools.result.tools ?? []) {
      const name = asNonEmptyString(tool.name);
      if (name) {
        this.availableTools.add(name);
      }
    }

    this.initialized = true;
    return true;
  }

  private async callTool(
    name: string,
    argumentsPayload: Record<string, unknown>,
    warnings: string[],
  ): Promise<McpToolCallResult | undefined> {
    if (this.initialized && this.availableTools.size > 0 && !this.availableTools.has(name)) {
      warnings.push(
        formatWarning(
          "MCP_PROVIDER_WARNING",
          `OpenMetadata MCP server does not advertise tool '${name}'.`,
        ),
      );
      return undefined;
    }

    this.observability.toolCalls += 1;
    const outcome = await this.callJsonRpc<McpToolCallResult>("tools/call", {
      name,
      arguments: argumentsPayload,
    });

    if (!outcome.ok) {
      warnings.push(outcome.warning);
      return undefined;
    }

    return outcome.result;
  }

  private extractLineageNodes(result: McpToolCallResult, upstreamFrom: string): LineageNode[] {
    const mapped = new Map<string, LineageNode>();
    const nodeMapById = new Map<string, LineageNode>();

    const addNode = (node: LineageNode): void => {
      const existing = mapped.get(node.fqn);
      if (!existing) {
        mapped.set(node.fqn, node);
        nodeMapById.set(node.id, node);
        return;
      }

      mapped.set(node.fqn, {
        ...existing,
        ...node,
        url: existing.url ?? node.url,
        domain: existing.domain ?? node.domain,
        tags: mergeStringLists(existing.tags, node.tags),
        owners: mergeStringLists(existing.owners, node.owners),
        glossaryTerms: mergeStringLists(existing.glossaryTerms, node.glossaryTerms),
      });
    };

    const parseStructured = (input: unknown): void => {
      if (Array.isArray(input)) {
        for (const item of input) {
          parseStructured(item);
        }
        return;
      }

      const obj = asRecord(input);
      if (!obj) {
        return;
      }

      const directNode = readNodeFromUnknown(obj, upstreamFrom);
      if (directNode) {
        addNode(directNode);
      }

      const nodes = Array.isArray(obj.nodes) ? obj.nodes : [];
      for (const item of nodes) {
        const parsed = readNodeFromUnknown(item, upstreamFrom);
        if (parsed) {
          addNode(parsed);
        }
      }

      const downstreamNodes = Array.isArray(obj.downstreamNodes) ? obj.downstreamNodes : [];
      for (const item of downstreamNodes) {
        const parsed = readNodeFromUnknown(item, upstreamFrom);
        if (parsed) {
          addNode(parsed);
        }
      }

      const downstreamEdges = Array.isArray(obj.downstreamEdges) ? obj.downstreamEdges : [];
      for (const edge of downstreamEdges) {
        const edgeObj = asRecord(edge);
        if (!edgeObj) {
          continue;
        }

        const toEntity = edgeObj.toEntity;
        const parsedTo = readNodeFromUnknown(toEntity, upstreamFrom);
        if (parsedTo) {
          addNode(parsedTo);
          continue;
        }

        if (typeof toEntity === "string") {
          const fromMap = nodeMapById.get(toEntity) ?? mapped.get(toEntity);
          if (fromMap) {
            addNode({ ...fromMap, upstreamFrom });
          }
        }
      }
    };

    for (const candidate of readStructuredCandidates(result)) {
      parseStructured(candidate);
    }

    for (const text of tryReadTextPayloads(result)) {
      for (const node of extractNodesFromText(text, upstreamFrom)) {
        addNode(node);
      }
    }

    return [...mapped.values()];
  }

  private async discoverEntityFqn(entity: CanonicalEntity, warnings: string[]): Promise<string | undefined> {
    const query = entity.table || normalizeEntityFqn(entity);
    const result = await this.callTool(
      MCP_TOOL_SEARCH_METADATA,
      {
        query,
        entity_type: "table",
        limit: MAX_SEARCH_LIMIT,
      },
      warnings,
    );
    if (!result) {
      return undefined;
    }

    const candidates = new Set<string>();

    const collectFromUnknown = (input: unknown): void => {
      if (typeof input === "string") {
        const fqnRegex = /\b[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+){2,}\b/g;
        for (const match of input.matchAll(fqnRegex)) {
          const candidate = match[0]?.trim();
          if (candidate) {
            candidates.add(candidate);
          }
        }
        return;
      }

      if (Array.isArray(input)) {
        for (const item of input) {
          collectFromUnknown(item);
        }
        return;
      }

      const obj = asRecord(input);
      if (!obj) {
        return;
      }

      for (const [key, value] of Object.entries(obj)) {
        if (
          key.toLowerCase().includes("fqn") &&
          typeof value === "string" &&
          value.includes(".")
        ) {
          candidates.add(value);
        }
        collectFromUnknown(value);
      }
    };

    for (const candidate of readStructuredCandidates(result)) {
      collectFromUnknown(candidate);
    }
    for (const text of tryReadTextPayloads(result)) {
      collectFromUnknown(text);
    }

    if (candidates.size === 0) {
      return undefined;
    }

    const ordered = [...candidates];
    const preferred = ordered.find((candidate) =>
      entity.table ? candidate.toLowerCase().endsWith(`.${entity.table.toLowerCase()}`) : false,
    );

    return preferred ?? ordered[0];
  }

  private async enrichNodesWithEntityDetails(nodes: LineageNode[], warnings: string[]): Promise<void> {
    if (!this.availableTools.has(MCP_TOOL_GET_ENTITY_DETAILS)) {
      return;
    }

    const toEnrich = nodes.slice(0, MAX_DETAIL_LOOKUPS);
    for (const node of toEnrich) {
      const entityType = mapNodeTypeToEntityType(node.type);
      if (!entityType) {
        continue;
      }

      const details = await this.callTool(
        MCP_TOOL_GET_ENTITY_DETAILS,
        {
          entity_type: entityType,
          fqn: node.fqn,
        },
        warnings,
      );

      if (!details) {
        continue;
      }

      const structured = readStructuredCandidates(details);
      const textPayloads = tryReadTextPayloads(details);

      const tagsFromStructured: string[] = [];
      const ownersFromStructured: string[] = [];
      const termsFromStructured: string[] = [];
      let domainFromStructured: string | undefined;

      const collectDetails = (input: unknown): void => {
        if (Array.isArray(input)) {
          for (const item of input) {
            collectDetails(item);
          }
          return;
        }

        const obj = asRecord(input);
        if (!obj) {
          return;
        }

        tagsFromStructured.push(...readStringList(obj.tags));
        ownersFromStructured.push(...readStringList(obj.owners ?? obj.owner));
        termsFromStructured.push(...readStringList(obj.glossaryTerms));
        domainFromStructured = domainFromStructured ?? readEntityName(obj.domain)?.toLowerCase();

        for (const value of Object.values(obj)) {
          collectDetails(value);
        }
      };

      for (const candidate of structured) {
        collectDetails(candidate);
      }

      const mergedText = textPayloads.join("\n");
      const markdownFieldValues = (label: string): string[] => {
        const regex = new RegExp(`\\*\\*${label}\\*\\*:\\s*([^\\n]+)`, "i");
        const match = mergedText.match(regex);
        if (!match || !match[1]) {
          return [];
        }
        return match[1]
          .split(",")
          .map((value) => value.replace(/[*`]/g, "").trim())
          .filter(Boolean);
      };

      const tags = normalizeList([...tagsFromStructured, ...markdownFieldValues("Tags")]);
      const owners = normalizeList([...ownersFromStructured, ...markdownFieldValues("Owners")]);
      const glossaryTerms = normalizeList(termsFromStructured);
      const domain = domainFromStructured;

      node.tags = mergeStringLists(node.tags, tags);
      node.owners = mergeStringLists(node.owners, owners);
      node.glossaryTerms = mergeStringLists(node.glossaryTerms, glossaryTerms);
      node.domain = node.domain ?? domain;
    }
  }

  private async callJsonRpc<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<{ ok: true; result: T } | { ok: false; warning: string }> {
    if (!this.config.mcpEndpoint) {
      return {
        ok: false,
        warning: formatWarning(
          "MCP_NOT_CONFIGURED",
          "MCP endpoint is not configured for OpenMetadata MCP integration.",
        ),
      };
    }

    this.observability.requests += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(this.config.mcpEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.authToken}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: this.requestId++,
          method,
          ...(params ? { params } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          ok: false,
          warning: createMcpWarning(response.status, method),
        };
      }

      const payload = (await response.json()) as McpJsonRpcResponse<T>;
      if (payload.error) {
        const warningCode = payload.error.code === -32002 ? "AUTH_ERROR" : "MCP_REQUEST_FAILED";
        return {
          ok: false,
          warning: formatWarning(
            warningCode,
            `OpenMetadata MCP '${method}' returned error ${payload.error.code}: ${payload.error.message}.`,
          ),
        };
      }

      if (payload.result === undefined) {
        return {
          ok: false,
          warning: formatWarning(
            "MCP_PROVIDER_WARNING",
            `OpenMetadata MCP '${method}' returned no result payload.`,
          ),
        };
      }

      return { ok: true, result: payload.result };
    } catch (error) {
      return {
        ok: false,
        warning: formatWarning(
          "MCP_REQUEST_FAILED",
          `OpenMetadata MCP request '${method}' failed: ${String(error)}.`,
        ),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
