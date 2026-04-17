import * as core from "@actions/core";
import {
  ActionConfig,
  ConfigurationError,
  LineageProviderMode,
} from "./types";

const DEFAULT_PATTERNS = [
  "**/*.sql",
  "**/models/**/*.sql",
  "**/models/**/*.yml",
  "**/models/**/*.yaml",
  "**/schema.yml",
  "**/schema.yaml",
  "**/dbt_project.yml",
  "**/dbt_project.yaml",
];

const DEFAULT_CRITICAL_TAGS = ["tier1", "critical", "business_critical"];

function parsePositiveInt(name: string, raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new ConfigurationError(`${name} must be a positive integer. Received: ${raw}`);
  }
  return value;
}

function parsePatterns(raw: string): string[] {
  const values = raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return values.length > 0 ? values : DEFAULT_PATTERNS;
}

function parseList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === "localhost" || lower === "127.0.0.1" || lower === "::1";
}

function validateEndpoint(
  name: string,
  endpoint: string,
  allowHosts: string[],
  allowInsecureLocalEndpoints: boolean,
): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ConfigurationError(`${name} must be a valid URL. Received: ${endpoint}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ConfigurationError(`${name} must use http or https protocol.`);
  }

  if (parsed.protocol === "http:") {
    if (!allowInsecureLocalEndpoints || !isLoopbackHost(parsed.hostname)) {
      throw new ConfigurationError(
        `${name} must use https unless allow-insecure-local-endpoints is true for localhost/loopback.`,
      );
    }
  }

  if (allowHosts.length > 0) {
    const normalized = allowHosts.map((host) => host.toLowerCase());
    if (!normalized.includes(parsed.hostname.toLowerCase())) {
      throw new ConfigurationError(
        `${name} host ${parsed.hostname} is not in allowed-endpoint-hosts list.`,
      );
    }
  }
}

function parseProviderMode(raw: string): LineageProviderMode {
  const mode = raw.trim().toLowerCase();
  if (mode === "api" || mode === "mcp" || mode === "auto") {
    return mode;
  }
  throw new ConfigurationError(
    `lineage-provider must be one of api|mcp|auto. Received: ${raw}`,
  );
}

export function getConfig(): ActionConfig {
  const openMetadataEndpoint = core.getInput("openmetadata-endpoint", {
    required: true,
  });
  const authToken = core.getInput("auth-token", { required: true });
  const githubToken =
    core.getInput("github-token").trim() || process.env.GITHUB_TOKEN?.trim() || "";
  const filePatterns = parsePatterns(core.getInput("file-patterns"));
  const lineageProvider = parseProviderMode(core.getInput("lineage-provider") || "auto");
  const mcpEndpointRaw = core.getInput("mcp-endpoint").trim();
  const aiSummaryEndpointRaw = core.getInput("ai-summary-endpoint").trim();
  const allowedEndpointHosts = parseList(core.getInput("allowed-endpoint-hosts")).map((host) =>
    host.toLowerCase(),
  );
  const allowInsecureLocalEndpoints = core.getBooleanInput("allow-insecure-local-endpoints");
  const criticalAssetTagsRaw = parseList(core.getInput("critical-asset-tags")).map((tag) =>
    tag.toLowerCase(),
  );

  const config: ActionConfig = {
    openMetadataEndpoint: openMetadataEndpoint.replace(/\/$/, ""),
    authToken,
    githubToken,
    filePatterns,
    lineageProvider,
    maxLineageDepth: parsePositiveInt(
      "max-lineage-depth",
      core.getInput("max-lineage-depth") || "3",
    ),
    maxConcurrency: parsePositiveInt(
      "max-concurrency",
      core.getInput("max-concurrency") || "4",
    ),
    maxTrackedFiles: parsePositiveInt(
      "max-tracked-files",
      core.getInput("max-tracked-files") || "200",
    ),
    maxEntities: parsePositiveInt(
      "max-entities",
      core.getInput("max-entities") || "500",
    ),
    maxDownstreamAssets: parsePositiveInt(
      "max-downstream-assets",
      core.getInput("max-downstream-assets") || "2000",
    ),
    requestTimeoutMs: parsePositiveInt(
      "request-timeout-ms",
      core.getInput("request-timeout-ms") || "15000",
    ),
    maxRetries: parsePositiveInt("max-retries", core.getInput("max-retries") || "3"),
    failOnMissingMetadata: core.getBooleanInput("fail-on-missing-metadata"),
    aiSummaryEnabled: core.getBooleanInput("ai-summary-enabled"),
    strictSqlParse: core.getBooleanInput("strict-sql-parse"),
    criticalAssetTags:
      criticalAssetTagsRaw.length > 0
        ? criticalAssetTagsRaw
        : DEFAULT_CRITICAL_TAGS.map((tag) => tag.toLowerCase()),
    allowedEndpointHosts,
    allowInsecureLocalEndpoints,
    maxCommentAssets: parsePositiveInt(
      "max-comment-assets",
      core.getInput("max-comment-assets") || "20",
    ),
  };

  if (mcpEndpointRaw.length > 0) {
    config.mcpEndpoint = mcpEndpointRaw;
  }

  if (aiSummaryEndpointRaw.length > 0) {
    config.aiSummaryEndpoint = aiSummaryEndpointRaw;
  }

  validateEndpoint(
    "openmetadata-endpoint",
    config.openMetadataEndpoint,
    config.allowedEndpointHosts,
    config.allowInsecureLocalEndpoints,
  );

  if (config.mcpEndpoint) {
    validateEndpoint(
      "mcp-endpoint",
      config.mcpEndpoint,
      config.allowedEndpointHosts,
      config.allowInsecureLocalEndpoints,
    );
  }

  if (config.aiSummaryEndpoint) {
    validateEndpoint(
      "ai-summary-endpoint",
      config.aiSummaryEndpoint,
      config.allowedEndpointHosts,
      config.allowInsecureLocalEndpoints,
    );
  }

  if (githubToken.length === 0) {
    throw new ConfigurationError(
      "github-token input is required when GITHUB_TOKEN is not present in the environment.",
    );
  }

  core.setSecret(authToken);
  core.setSecret(githubToken);

  return config;
}
