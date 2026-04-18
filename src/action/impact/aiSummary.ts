import { ActionConfig, ImpactSummary } from "../types";
import { formatWarning } from "../warnings";

interface AiSummaryPayload {
  summary?: string;
}

export async function buildOptionalAiSummary(
  config: ActionConfig,
  impactSeed: Pick<ImpactSummary, "riskLevel" | "changedEntityCount" | "impactedAssetCount" | "warnings">,
): Promise<{ summary?: string; warning?: string }> {
  if (!config.aiSummaryEnabled) {
    return {};
  }

  if (!config.aiSummaryEndpoint) {
    return {
      summary: `Risk ${impactSeed.riskLevel.toUpperCase()}: ${impactSeed.impactedAssetCount} impacted assets across downstream dependencies.`,
      warning: formatWarning(
        "AI_SUMMARY_FALLBACK",
        "AI summary enabled without ai-summary-endpoint. Using deterministic fallback summary.",
      ),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(config.aiSummaryEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: "summarize-impact-analysis",
        payload: impactSeed,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        warning: formatWarning(
          "AI_SUMMARY_FAILED",
          `AI summary request failed with status ${response.status}.`,
        ),
      };
    }

    const data = (await response.json()) as AiSummaryPayload;
    if (!data.summary) {
      return {
        warning: formatWarning("AI_SUMMARY_FAILED", "AI summary endpoint returned no summary text."),
      };
    }

    return { summary: data.summary };
  } catch (error) {
    return {
      warning: formatWarning("AI_SUMMARY_FAILED", `AI summary request failed: ${String(error)}`),
    };
  } finally {
    clearTimeout(timer);
  }
}
