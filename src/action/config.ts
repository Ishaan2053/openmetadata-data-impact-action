import * as core from "@actions/core";
import {
  ActionConfig,
  ConfigurationError,
  LineageProviderMode,
  RiskThresholds,
} from "./types";

export const DEFAULT_PATTERNS = [
  "**/*.sql",
  "**/models/**/*.yml",
  "**/models/**/*.yaml",
  "**/schema.yml",
  "**/schema.yaml",
  "**/dbt_project.yml",
  "**/dbt_project.yaml",
];

export const DEFAULT_CRITICAL_TAGS = ["tier1", "critical", "business_critical"];
export const OPENMETADATA_MAX_LINEAGE_DEPTH = 3;

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  dashboardHigh: 5,
  pipelineHigh: 4,
  reportHigh: 8,
  totalHigh: 20,
  warningCountHigh: 3,
  warningMinAssetsHigh: 8,
  lowConfidenceHigh: 10,
};

function parsePositiveInt(name: string, raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new ConfigurationError(`${name} must be a positive integer. Received: ${raw}`);
  }
  return value;
}

function parseNonNegativeInt(name: string, raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 0) {
    throw new ConfigurationError(`${name} must be a non-negative integer. Received: ${raw}`);
  }
  return value;
}

function parseBoundedPositiveInt(name: string, raw: string, min: number, max: number): number {
  const value = parsePositiveInt(name, raw);
  if (value < min || value > max) {
    const suffix =
      name === "max-lineage-depth"
        ? " OpenMetadata lineage API supports a maximum depth of 3 per request."
        : "";
    throw new ConfigurationError(
      `${name} must be between ${min} and ${max}. Received: ${raw}.${suffix}`,
    );
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

function parseRiskThresholds(): RiskThresholds {
  return {
    dashboardHigh: parsePositiveInt(
      "risk-high-dashboard-count",
      core.getInput("risk-high-dashboard-count") || String(DEFAULT_RISK_THRESHOLDS.dashboardHigh),
    ),
    pipelineHigh: parsePositiveInt(
      "risk-high-pipeline-count",
      core.getInput("risk-high-pipeline-count") || String(DEFAULT_RISK_THRESHOLDS.pipelineHigh),
    ),
    reportHigh: parsePositiveInt(
      "risk-high-report-count",
      core.getInput("risk-high-report-count") || String(DEFAULT_RISK_THRESHOLDS.reportHigh),
    ),
    totalHigh: parsePositiveInt(
      "risk-high-total-assets",
      core.getInput("risk-high-total-assets") || String(DEFAULT_RISK_THRESHOLDS.totalHigh),
    ),
    warningCountHigh: parsePositiveInt(
      "risk-high-warning-count",
      core.getInput("risk-high-warning-count") || String(DEFAULT_RISK_THRESHOLDS.warningCountHigh),
    ),
    warningMinAssetsHigh: parsePositiveInt(
      "risk-high-warning-min-assets",
      core.getInput("risk-high-warning-min-assets") || String(DEFAULT_RISK_THRESHOLDS.warningMinAssetsHigh),
    ),
    lowConfidenceHigh: parsePositiveInt(
      "risk-high-low-confidence-count",
      core.getInput("risk-high-low-confidence-count") || String(DEFAULT_RISK_THRESHOLDS.lowConfidenceHigh),
    ),
  };
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
  const impactJsonFileRaw = core.getInput("impact-json-file").trim();
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
    maxLineageDepth: parseBoundedPositiveInt(
      "max-lineage-depth",
      core.getInput("max-lineage-depth") || "3",
      1,
      OPENMETADATA_MAX_LINEAGE_DEPTH,
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
    maxRetries: parseNonNegativeInt("max-retries", core.getInput("max-retries") || "3"),
    failOnMissingMetadata: core.getBooleanInput("fail-on-missing-metadata"),
    aiSummaryEnabled: core.getBooleanInput("ai-summary-enabled"),
    strictSqlParse: core.getBooleanInput("strict-sql-parse"),
    criticalAssetTags:
      criticalAssetTagsRaw.length > 0
        ? criticalAssetTagsRaw
        : DEFAULT_CRITICAL_TAGS.map((tag) => tag.toLowerCase()),
    riskThresholds: parseRiskThresholds(),
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

  if (impactJsonFileRaw.length > 0) {
    config.impactJsonFile = impactJsonFileRaw;
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
