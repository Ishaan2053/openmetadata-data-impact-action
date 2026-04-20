export type WarningCode =
  | "METADATA_MISSING"
  | "LINEAGE_EMPTY_PAYLOAD"
  | "LINEAGE_REQUEST_FAILED"
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "LINEAGE_UNAVAILABLE"
  | "MCP_NOT_CONFIGURED"
  | "MCP_REQUEST_FAILED"
  | "MCP_PROVIDER_WARNING"
  | "PARSE_FAILED"
  | "AI_SUMMARY_FAILED"
  | "AI_SUMMARY_FALLBACK"
  | "COMMENT_PUBLISH_FAILED"
  | "RETRY_BUDGET_EXHAUSTED"
  | "TRUNCATED_TRACKED_FILES"
  | "TRUNCATED_ENTITIES"
  | "TRUNCATED_DOWNSTREAM";

export type AnalysisStatus = "success" | "partial" | "degraded" | "skipped" | "failed";

const KNOWN_WARNING_CODES = new Set<WarningCode>([
  "METADATA_MISSING",
  "LINEAGE_EMPTY_PAYLOAD",
  "LINEAGE_REQUEST_FAILED",
  "AUTH_ERROR",
  "RATE_LIMITED",
  "NETWORK_ERROR",
  "SERVICE_UNAVAILABLE",
  "LINEAGE_UNAVAILABLE",
  "MCP_NOT_CONFIGURED",
  "MCP_REQUEST_FAILED",
  "MCP_PROVIDER_WARNING",
  "PARSE_FAILED",
  "AI_SUMMARY_FAILED",
  "AI_SUMMARY_FALLBACK",
  "COMMENT_PUBLISH_FAILED",
  "RETRY_BUDGET_EXHAUSTED",
  "TRUNCATED_TRACKED_FILES",
  "TRUNCATED_ENTITIES",
  "TRUNCATED_DOWNSTREAM",
]);

const WARNING_PREFIX = /^\[([A-Z0-9_]+)\]\s*/;

const DEGRADED_WARNING_CODES = new Set<WarningCode>([
  "AUTH_ERROR",
  "RATE_LIMITED",
  "NETWORK_ERROR",
  "SERVICE_UNAVAILABLE",
  "LINEAGE_UNAVAILABLE",
  "MCP_REQUEST_FAILED",
  "RETRY_BUDGET_EXHAUSTED",
]);

const PARTIAL_WARNING_CODES = new Set<WarningCode>([
  "METADATA_MISSING",
  "LINEAGE_EMPTY_PAYLOAD",
  "PARSE_FAILED",
  "AI_SUMMARY_FAILED",
  "AI_SUMMARY_FALLBACK",
  "COMMENT_PUBLISH_FAILED",
  "MCP_NOT_CONFIGURED",
  "MCP_PROVIDER_WARNING",
  "TRUNCATED_TRACKED_FILES",
  "TRUNCATED_ENTITIES",
  "TRUNCATED_DOWNSTREAM",
]);

export function formatWarning(code: WarningCode, message: string): string {
  return `[${code}] ${message}`;
}

export function extractWarningCode(warning: string): WarningCode | undefined {
  const match = warning.match(WARNING_PREFIX);
  if (!match) {
    return undefined;
  }

  const candidate = match[1] as WarningCode;
  if (!KNOWN_WARNING_CODES.has(candidate)) {
    return undefined;
  }

  return candidate;
}

export function hasWarningCode(warnings: string[], code: WarningCode): boolean {
  return warnings.some((warning) => extractWarningCode(warning) === code);
}

export function countWarningCode(warnings: string[], code: WarningCode): number {
  return warnings.filter((warning) => extractWarningCode(warning) === code).length;
}

export function warningCodeCounts(warnings: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const warning of warnings) {
    const code = extractWarningCode(warning);
    if (!code) {
      continue;
    }
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

export function extractWarningCodes(warnings: string[]): WarningCode[] {
  const seen = new Set<WarningCode>();
  for (const warning of warnings) {
    const code = extractWarningCode(warning);
    if (code) {
      seen.add(code);
    }
  }
  return [...seen];
}

export function computeAnalysisStatus(warnings: string[], truncated: boolean): AnalysisStatus {
  const warningCodes = extractWarningCodes(warnings);

  if (warningCodes.some((code) => DEGRADED_WARNING_CODES.has(code))) {
    return "degraded";
  }

  if (truncated || warningCodes.some((code) => PARTIAL_WARNING_CODES.has(code))) {
    return "partial";
  }

  return "success";
}
