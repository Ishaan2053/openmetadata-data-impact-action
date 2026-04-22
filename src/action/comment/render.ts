import { ActionConfig, AssetType, ImpactSummary } from "../types";

const DISPLAY_LABELS: Record<AssetType, string> = {
  dashboard: "Dashboards",
  pipeline: "Pipelines",
  report: "Reports",
  table: "Tables",
  view: "Views",
  topic: "Topics",
  other: "Other Assets",
};

const ORDER: AssetType[] = [
  "dashboard",
  "pipeline",
  "report",
  "table",
  "view",
  "topic",
  "other",
];

const MAX_WARNING_DETAILS = 40;
const MAX_CHANGE_HIGHLIGHT_LENGTH = 180;

function neutralizeMentions(value: string): string {
  return value.replace(/@/g, "&#64;");
}

function neutralizeDangerousSchemes(value: string): string {
  return value
    .replace(/\bjavascript:/gi, "javascript&#58;")
    .replace(/\bvbscript:/gi, "vbscript&#58;")
    .replace(/\bdata:/gi, "data&#58;");
}

function escapeMarkdownInline(value: string): string {
  return value.replace(/([\\`{}\[\]()|<>])/g, "\\$1");
}

function sanitizeText(value: string): string {
  const flattened = value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  return escapeMarkdownInline(neutralizeDangerousSchemes(neutralizeMentions(flattened)));
}

function sanitizeMultiline(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => sanitizeText(line))
    .join("\n");
}

function safeHttpUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function capitalizeRisk(risk: ImpactSummary["riskLevel"]): string {
  return risk.charAt(0).toUpperCase() + risk.slice(1);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function parseWarningCode(warning: string): string | undefined {
  const match = warning.match(/^\[([A-Z0-9_]+)\]\s*/);
  return match?.[1];
}

function buildWarningCodeCounts(warnings: string[]): Array<{ code: string; count: number }> {
  const counts = new Map<string, number>();
  for (const warning of warnings) {
    const code = parseWarningCode(warning);
    if (!code) {
      continue;
    }

    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

function parseWhatChangedItem(item: string): {
  file: string;
  delta: string;
  highlight: string;
} | undefined {
  const match = item.match(/^(.+?):\s*\+(\d+)\/-([\d]+);\s*(.+)$/);
  if (!match) {
    return undefined;
  }

  const file = match[1] ?? "";
  const added = match[2] ?? "0";
  const removed = match[3] ?? "0";
  const highlight = match[4] ?? "";
  return {
    file,
    delta: `+${added}/-${removed}`,
    highlight,
  };
}

function renderWhatChangedSection(lines: string[], whatChanged: string[]): void {
  if (whatChanged.length === 0) {
    return;
  }

  lines.push("### What Changed");
  lines.push("");

  const parsed = whatChanged.map(parseWhatChangedItem);
  if (parsed.every((item) => Boolean(item))) {
    lines.push("| File | Delta | Highlight |");
    lines.push("|---|---:|---|");
    for (const item of parsed) {
      if (!item) {
        continue;
      }

      lines.push(
        `| ${sanitizeText(item.file)} | ${sanitizeText(item.delta)} | ${sanitizeText(truncateText(item.highlight, MAX_CHANGE_HIGHLIGHT_LENGTH))} |`,
      );
    }
  } else {
    for (const item of whatChanged) {
      lines.push(`- ${sanitizeText(item)}`);
    }
  }

  lines.push("");
}

function renderSummarySection(lines: string[], summary: ImpactSummary): void {
  lines.push("### Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---:|");
  lines.push(`| Risk | **${capitalizeRisk(summary.riskLevel)}** |`);
  lines.push(`| Changed entities | **${summary.changedEntityCount}** |`);
  lines.push(`| Low-confidence entities | **${summary.lowConfidenceEntityCount}** |`);
  lines.push(`| Impacted downstream assets | **${summary.impactedAssetCount}** |`);
  lines.push(`| Warnings | **${summary.warnings.length}** |`);
  lines.push(`| Truncated analysis | **${summary.truncated ? "yes" : "no"}** |`);
  lines.push("");
}

function renderSuggestionsSection(lines: string[], suggestions: string[]): void {
  if (suggestions.length === 0) {
    return;
  }

  lines.push("### Suggestions");
  lines.push("");
  for (const [index, suggestion] of suggestions.entries()) {
    lines.push(`${index + 1}. ${sanitizeText(suggestion)}`);
  }
  lines.push("");
}

function renderWarningsSection(lines: string[], warnings: string[]): void {
  if (warnings.length === 0) {
    return;
  }

  lines.push(`### Warnings (${warnings.length})`);
  lines.push("");

  const codeCounts = buildWarningCodeCounts(warnings);
  if (codeCounts.length > 0) {
    lines.push("| Warning Code | Count |");
    lines.push("|---|---:|");
    for (const item of codeCounts) {
      lines.push(`| ${sanitizeText(item.code)} | ${item.count} |`);
    }
    lines.push("");
  }

  const warningDetails = warnings.slice(0, MAX_WARNING_DETAILS);
  lines.push("<details>");
  lines.push("<summary>Show warning details</summary>");
  lines.push("");
  for (const warning of warningDetails) {
    lines.push(`- ${sanitizeText(warning)}`);
  }
  if (warnings.length > warningDetails.length) {
    lines.push(`- ... and ${warnings.length - warningDetails.length} additional warnings.`);
  }
  lines.push("");
  lines.push("</details>");
  lines.push("");
}

function renderImpactedAssetCounts(summary: ImpactSummary): string[] {
  const rows: string[] = [];
  const nonZero = ORDER.filter((type) => summary.impactedByType[type].length > 0);
  if (nonZero.length === 0) {
    return rows;
  }

  rows.push("| Asset Type | Count |");
  rows.push("|---|---:|");
  for (const type of nonZero) {
    rows.push(`| ${DISPLAY_LABELS[type]} | ${summary.impactedByType[type].length} |`);
  }
  rows.push("");
  return rows;
}

function renderAssetRows(
  summary: ImpactSummary,
  config: ActionConfig,
  options?: { collapsible?: boolean },
): string[] {
  const collapsible = options?.collapsible ?? false;
  const rows: string[] = [];

  for (const type of ORDER) {
    const assets = summary.impactedByType[type];
    if (assets.length === 0) {
      continue;
    }

    if (collapsible) {
      rows.push("<details>");
      rows.push(`<summary><strong>${DISPLAY_LABELS[type]} (${assets.length})</strong></summary>`);
      rows.push("");
    } else {
      rows.push(`### ${DISPLAY_LABELS[type]} (${assets.length})`);
    }

    const slice = assets.slice(0, config.maxCommentAssets);
    for (const asset of slice) {
      const safeName = sanitizeText(asset.name);
      const safeUrl = safeHttpUrl(asset.url);
      const linkOrName = safeUrl ? `[${safeName}](${safeUrl})` : safeName;
      const reason = sanitizeText(asset.reasons[0] ?? "Downstream dependency");
      const criticalTag = (asset.tags ?? []).some((tag) => config.criticalAssetTags.includes(tag))
        ? " [critical]"
        : "";
      rows.push(`- ${linkOrName} (${sanitizeText(asset.fqn)})`);
      rows.push(`  - Reason: ${reason}${criticalTag}`);
      if (asset.owners && asset.owners.length > 0) {
        rows.push(`  - Owners: ${asset.owners.map((owner) => sanitizeText(owner)).join(", ")}`);
      }
      if (asset.domain) {
        rows.push(`  - Domain: ${sanitizeText(asset.domain)}`);
      }
      if (asset.glossaryTerms && asset.glossaryTerms.length > 0) {
        rows.push(
          `  - Glossary terms: ${asset.glossaryTerms.map((term) => sanitizeText(term)).join(", ")}`,
        );
      }
    }

    if (assets.length > config.maxCommentAssets) {
      rows.push(
        `- ... and ${assets.length - config.maxCommentAssets} more ${DISPLAY_LABELS[type].toLowerCase()}.`,
      );
    }

    if (collapsible) {
      rows.push("");
      rows.push("</details>");
    }

    rows.push("");
  }

  return rows;
}

export function renderImpactComment(summary: ImpactSummary, config: ActionConfig): string {
  const lines: string[] = [];
  lines.push("## Data Impact Analysis");
  lines.push("");
  lines.push("Clear summary of changed data entities, downstream impact, and operational risk.");
  lines.push("");

  const whatChanged = summary.whatChanged ?? [];
  renderWhatChangedSection(lines, whatChanged);
  renderSummarySection(lines, summary);

  if (summary.aiSummary) {
    lines.push("### Optional AI Summary");
    lines.push("");
    lines.push(sanitizeMultiline(summary.aiSummary));
    lines.push("");
  }

  const assets = renderAssetRows(summary, config, { collapsible: true });
  if (assets.length > 0) {
    lines.push("### Impacted Assets");
    lines.push("");
    lines.push(...renderImpactedAssetCounts(summary));
    lines.push(...assets);
  } else {
    lines.push("### Impacted Assets");
    lines.push("");
    lines.push("No downstream assets were identified from available lineage data.");
    lines.push("");
  }

  renderWarningsSection(lines, summary.warnings);
  renderSuggestionsSection(lines, summary.suggestions);

  lines.push("---");
  lines.push("_Generated by OpenMetadata Impact Analysis Action_");

  return lines.join("\n").trim();
}

export function renderDetailedImpactReport(summary: ImpactSummary, config: ActionConfig): string {
  const lines: string[] = [];
  lines.push("## Full Data Impact Report");
  lines.push("");

  const whatChanged = summary.whatChanged ?? [];
  renderWhatChangedSection(lines, whatChanged);

  renderSummarySection(lines, summary);

  const fullConfig: ActionConfig = {
    ...config,
    maxCommentAssets: Number.MAX_SAFE_INTEGER,
  };

  lines.push("### Full Impacted Asset List");
  lines.push("");
  lines.push(...renderAssetRows(summary, fullConfig));

  renderWarningsSection(lines, summary.warnings);

  return lines.join("\n").trim();
}
