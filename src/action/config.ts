import * as core from "@actions/core";
import {
  ActionConfig,
  ConfigurationError,
  LineageProviderMode,
  OperatingMode,
  RiskWeighting,
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
export const DEFAULT_OPERATING_MODE: OperatingMode = "balanced";

const BASE_RUNTIME_DEFAULTS = {
  maxLineageDepth: OPENMETADATA_MAX_LINEAGE_DEPTH,
  maxConcurrency: 4,
  maxTrackedFiles: 200,
  maxEntities: 500,
  maxDownstreamAssets: 2000,
  requestTimeoutMs: 15000,
  maxRetries: 3,
  failOnMissingMetadata: false,
  strictSqlParse: false,
};

const OPERATING_MODE_PRESETS: Record<
  OperatingMode,
  {
    maxLineageDepth: number;
    maxConcurrency: number;
    maxTrackedFiles: number;
    maxEntities: number;
    maxDownstreamAssets: number;
    requestTimeoutMs: number;
    maxRetries: number;
    failOnMissingMetadata: boolean;
    strictSqlParse: boolean;
  }
> = {
  fast: {
    maxLineageDepth: 2,
    maxConcurrency: 6,
    maxTrackedFiles: 120,
    maxEntities: 300,
    maxDownstreamAssets: 1000,
    requestTimeoutMs: 10000,
    maxRetries: 1,
    failOnMissingMetadata: false,
    strictSqlParse: false,
  },
  balanced: {
    maxLineageDepth: BASE_RUNTIME_DEFAULTS.maxLineageDepth,
    maxConcurrency: BASE_RUNTIME_DEFAULTS.maxConcurrency,
    maxTrackedFiles: BASE_RUNTIME_DEFAULTS.maxTrackedFiles,
    maxEntities: BASE_RUNTIME_DEFAULTS.maxEntities,
    maxDownstreamAssets: BASE_RUNTIME_DEFAULTS.maxDownstreamAssets,
    requestTimeoutMs: BASE_RUNTIME_DEFAULTS.requestTimeoutMs,
    maxRetries: BASE_RUNTIME_DEFAULTS.maxRetries,
    failOnMissingMetadata: BASE_RUNTIME_DEFAULTS.failOnMissingMetadata,
    strictSqlParse: BASE_RUNTIME_DEFAULTS.strictSqlParse,
  },
  "strict-governance": {
    maxLineageDepth: 3,
    maxConcurrency: 3,
    maxTrackedFiles: 300,
    maxEntities: 800,
    maxDownstreamAssets: 3000,
    requestTimeoutMs: 20000,
    maxRetries: 5,
    failOnMissingMetadata: true,
    strictSqlParse: true,
  },
};

export const DEFAULT_RETRY_SAFEGUARDS = {
  maxRetryWaitMs: 15000,
  maxTotalRetryWaitMs: 60000,
};

export const DEFAULT_RISK_WEIGHTING: RiskWeighting = {
  governance: 0,
  usage: 0,
  dataQuality: 0,
  mediumThreshold: 6,
  highThreshold: 12,
};

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

function parseNonNegativeNumber(name: string, raw: string): number {
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value) || value < 0) {
    throw new ConfigurationError(`${name} must be a non-negative number. Received: ${raw}`);
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

function parseOperatingMode(raw: string): OperatingMode {
  const mode = raw.trim().toLowerCase();
  if (mode === "fast" || mode === "balanced" || mode === "strict-governance") {
    return mode;
  }
  throw new ConfigurationError(
    `operating-mode must be one of fast|balanced|strict-governance. Received: ${raw}`,
  );
}

function parseBooleanInput(name: string, raw: string, fallback: boolean): boolean {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    return fallback;
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  throw new ConfigurationError(`${name} must be true or false. Received: ${raw}`);
}

function withPresetIfDefault<T>(value: T, defaultValue: T, presetValue: T): T {
  return value === defaultValue ? presetValue : value;
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

function parseRiskWeighting(): RiskWeighting {
  const governance = parseNonNegativeNumber(
    "risk-weight-governance",
    core.getInput("risk-weight-governance") || String(DEFAULT_RISK_WEIGHTING.governance),
  );
  const usage = parseNonNegativeNumber(
    "risk-weight-usage",
    core.getInput("risk-weight-usage") || String(DEFAULT_RISK_WEIGHTING.usage),
  );
  const dataQuality = parseNonNegativeNumber(
    "risk-weight-data-quality",
    core.getInput("risk-weight-data-quality") || String(DEFAULT_RISK_WEIGHTING.dataQuality),
  );
  const mediumThreshold = parseNonNegativeNumber(
    "risk-weight-medium-threshold",
    core.getInput("risk-weight-medium-threshold") || String(DEFAULT_RISK_WEIGHTING.mediumThreshold),
  );
  const highThreshold = parseNonNegativeNumber(
    "risk-weight-high-threshold",
    core.getInput("risk-weight-high-threshold") || String(DEFAULT_RISK_WEIGHTING.highThreshold),
  );

  if (highThreshold < mediumThreshold) {
    throw new ConfigurationError(
      "risk-weight-high-threshold must be greater than or equal to risk-weight-medium-threshold.",
    );
  }

  return {
    governance,
    usage,
    dataQuality,
    mediumThreshold,
    highThreshold,
  };
}

export function getConfig(): ActionConfig {
  const openMetadataEndpoint = core.getInput("openmetadata-endpoint", {
    required: true,
  });
  const normalizedOpenMetadataEndpoint = openMetadataEndpoint.replace(/\/$/, "");
  const authToken = core.getInput("auth-token", { required: true });
  const githubToken =
    core.getInput("github-token").trim() || process.env.GITHUB_TOKEN?.trim() || "";
  const filePatterns = parsePatterns(core.getInput("file-patterns"));
  const operatingMode = parseOperatingMode(core.getInput("operating-mode") || DEFAULT_OPERATING_MODE);
  const preset = OPERATING_MODE_PRESETS[operatingMode];
  const lineageProvider = parseProviderMode(core.getInput("lineage-provider") || "auto");
  const mcpEndpointRaw = core.getInput("mcp-endpoint").trim();
  const aiSummaryProviderRaw = core.getInput("ai-summary-provider").trim().toLowerCase();
  const aiSummaryModelRaw = core.getInput("ai-summary-model").trim();
  const aiSummaryApiKeyRaw = core.getInput("ai-summary-api-key").trim();
  const impactJsonFileRaw = core.getInput("impact-json-file").trim();
  const allowedEndpointHosts = parseList(core.getInput("allowed-endpoint-hosts")).map((host) =>
    host.toLowerCase(),
  );
  const allowInsecureLocalEndpoints = core.getBooleanInput("allow-insecure-local-endpoints");
  const criticalAssetTagsRaw = parseList(core.getInput("critical-asset-tags")).map((tag) =>
    tag.toLowerCase(),
  );

  const parsedMaxLineageDepth = parseBoundedPositiveInt(
    "max-lineage-depth",
    core.getInput("max-lineage-depth") || String(BASE_RUNTIME_DEFAULTS.maxLineageDepth),
    1,
    OPENMETADATA_MAX_LINEAGE_DEPTH,
  );
  const parsedMaxConcurrency = parsePositiveInt(
    "max-concurrency",
    core.getInput("max-concurrency") || String(BASE_RUNTIME_DEFAULTS.maxConcurrency),
  );
  const parsedMaxTrackedFiles = parsePositiveInt(
    "max-tracked-files",
    core.getInput("max-tracked-files") || String(BASE_RUNTIME_DEFAULTS.maxTrackedFiles),
  );
  const parsedMaxEntities = parsePositiveInt(
    "max-entities",
    core.getInput("max-entities") || String(BASE_RUNTIME_DEFAULTS.maxEntities),
  );
  const parsedMaxDownstreamAssets = parsePositiveInt(
    "max-downstream-assets",
    core.getInput("max-downstream-assets") || String(BASE_RUNTIME_DEFAULTS.maxDownstreamAssets),
  );
  const parsedRequestTimeoutMs = parsePositiveInt(
    "request-timeout-ms",
    core.getInput("request-timeout-ms") || String(BASE_RUNTIME_DEFAULTS.requestTimeoutMs),
  );
  const parsedMaxRetries = parseNonNegativeInt(
    "max-retries",
    core.getInput("max-retries") || String(BASE_RUNTIME_DEFAULTS.maxRetries),
  );
  const parsedFailOnMissingMetadata = parseBooleanInput(
    "fail-on-missing-metadata",
    core.getInput("fail-on-missing-metadata"),
    BASE_RUNTIME_DEFAULTS.failOnMissingMetadata,
  );
  const parsedStrictSqlParse = parseBooleanInput(
    "strict-sql-parse",
    core.getInput("strict-sql-parse"),
    BASE_RUNTIME_DEFAULTS.strictSqlParse,
  );

  const maxLineageDepth = withPresetIfDefault(
    parsedMaxLineageDepth,
    BASE_RUNTIME_DEFAULTS.maxLineageDepth,
    preset.maxLineageDepth,
  );
  const maxConcurrency = withPresetIfDefault(
    parsedMaxConcurrency,
    BASE_RUNTIME_DEFAULTS.maxConcurrency,
    preset.maxConcurrency,
  );
  const maxTrackedFiles = withPresetIfDefault(
    parsedMaxTrackedFiles,
    BASE_RUNTIME_DEFAULTS.maxTrackedFiles,
    preset.maxTrackedFiles,
  );
  const maxEntities = withPresetIfDefault(
    parsedMaxEntities,
    BASE_RUNTIME_DEFAULTS.maxEntities,
    preset.maxEntities,
  );
  const maxDownstreamAssets = withPresetIfDefault(
    parsedMaxDownstreamAssets,
    BASE_RUNTIME_DEFAULTS.maxDownstreamAssets,
    preset.maxDownstreamAssets,
  );
  const requestTimeoutMs = withPresetIfDefault(
    parsedRequestTimeoutMs,
    BASE_RUNTIME_DEFAULTS.requestTimeoutMs,
    preset.requestTimeoutMs,
  );
  const maxRetries = withPresetIfDefault(
    parsedMaxRetries,
    BASE_RUNTIME_DEFAULTS.maxRetries,
    preset.maxRetries,
  );
  const failOnMissingMetadata = withPresetIfDefault(
    parsedFailOnMissingMetadata,
    BASE_RUNTIME_DEFAULTS.failOnMissingMetadata,
    preset.failOnMissingMetadata,
  );
  const strictSqlParse = withPresetIfDefault(
    parsedStrictSqlParse,
    BASE_RUNTIME_DEFAULTS.strictSqlParse,
    preset.strictSqlParse,
  );

  const config: ActionConfig = {
    openMetadataEndpoint: normalizedOpenMetadataEndpoint,
    authToken,
    githubToken,
    operatingMode,
    filePatterns,
    lineageProvider,
    maxLineageDepth,
    maxConcurrency,
    maxTrackedFiles,
    maxEntities,
    maxDownstreamAssets,
    requestTimeoutMs,
    maxRetries,
    maxRetryWaitMs: parseNonNegativeInt(
      "max-retry-wait-ms",
      core.getInput("max-retry-wait-ms") || String(DEFAULT_RETRY_SAFEGUARDS.maxRetryWaitMs),
    ),
    maxTotalRetryWaitMs: parseNonNegativeInt(
      "max-total-retry-wait-ms",
      core.getInput("max-total-retry-wait-ms") || String(DEFAULT_RETRY_SAFEGUARDS.maxTotalRetryWaitMs),
    ),
    failOnMissingMetadata,
    aiSummaryEnabled: core.getBooleanInput("ai-summary-enabled"),
    strictSqlParse,
    criticalAssetTags:
      criticalAssetTagsRaw.length > 0
        ? criticalAssetTagsRaw
        : DEFAULT_CRITICAL_TAGS.map((tag) => tag.toLowerCase()),
    riskThresholds: parseRiskThresholds(),
    riskWeighting: parseRiskWeighting(),
    allowedEndpointHosts,
    allowInsecureLocalEndpoints,
    maxCommentAssets: parsePositiveInt(
      "max-comment-assets",
      core.getInput("max-comment-assets") || "20",
    ),
  };

  if (mcpEndpointRaw.length > 0) {
    config.mcpEndpoint = mcpEndpointRaw;
  } else {
    config.mcpEndpoint = `${normalizedOpenMetadataEndpoint}/mcp`;
  }

  if (aiSummaryProviderRaw.length > 0) {
    config.aiSummaryProvider = aiSummaryProviderRaw;
  }

  if (aiSummaryModelRaw.length > 0) {
    config.aiSummaryModel = aiSummaryModelRaw;
  }

  if (aiSummaryApiKeyRaw.length > 0) {
    config.aiSummaryApiKey = aiSummaryApiKeyRaw;
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

  if (githubToken.length === 0) {
    throw new ConfigurationError(
      "github-token input is required when GITHUB_TOKEN is not present in the environment.",
    );
  }

  core.setSecret(authToken);
  core.setSecret(githubToken);
  if (config.aiSummaryApiKey) {
    core.setSecret(config.aiSummaryApiKey);
  }

  return config;
}
