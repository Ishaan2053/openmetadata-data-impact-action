import { ActionConfig, ImpactSummary } from "../types";
import { Message, igniteModel } from "multi-llm-ts";
import { formatWarning } from "../warnings";

const AI_SUMMARY_SYSTEM_PROMPT =
  "You are an assistant that summarizes pull-request data impact reports for engineers. Return concise, factual output only.";

type AiModel = {
  complete: (messages: Message[]) => Promise<{ type?: string; content?: string }>;
};

type AiModelFactory = (input: {
  provider: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}) => AiModel;

const defaultAiModelFactory: AiModelFactory = (input) => {
  return igniteModel(input.provider, input.model, {
    apiKey: input.apiKey,
    timeout: input.timeoutMs,
  }) as AiModel;
};

let aiModelFactory: AiModelFactory = defaultAiModelFactory;

export function setAiModelFactoryForTests(factory?: AiModelFactory): void {
  aiModelFactory = factory ?? defaultAiModelFactory;
}

function deterministicFallbackSummary(
  impactSeed: Pick<ImpactSummary, "riskLevel" | "impactedAssetCount">,
): string {
  return `Risk ${impactSeed.riskLevel.toUpperCase()}: ${impactSeed.impactedAssetCount} impacted assets across downstream dependencies.`;
}

function parseSummaryFromModelContent(content: string): string | undefined {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const candidateStrings = [trimmed];

  const fencedJsonMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fencedJsonMatch?.[1]) {
    candidateStrings.push(fencedJsonMatch[1].trim());
  }

  for (const candidate of candidateStrings) {
    try {
      const parsed = JSON.parse(candidate) as { summary?: unknown };
      if (typeof parsed.summary === "string" && parsed.summary.trim().length > 0) {
        return parsed.summary.trim();
      }
    } catch {
      // Plain text responses are accepted as a fallback for compatibility.
    }
  }

  return trimmed;
}

function getMissingAiSummarySettings(config: ActionConfig): string[] {
  const missing: string[] = [];
  if (!config.aiSummaryProvider) {
    missing.push("ai-summary-provider");
  }
  if (!config.aiSummaryModel) {
    missing.push("ai-summary-model");
  }
  if (!config.aiSummaryApiKey) {
    missing.push("ai-summary-api-key");
  }
  return missing;
}

export async function buildOptionalAiSummary(
  config: ActionConfig,
  impactSeed: Pick<ImpactSummary, "riskLevel" | "changedEntityCount" | "impactedAssetCount" | "warnings">,
): Promise<{ summary?: string; warning?: string }> {
  if (!config.aiSummaryEnabled) {
    return {};
  }

  const missingSettings = getMissingAiSummarySettings(config);
  if (missingSettings.length > 0) {
    return {
      summary: deterministicFallbackSummary(impactSeed),
      warning: formatWarning(
        "AI_SUMMARY_FALLBACK",
        `AI summary enabled but missing ${missingSettings.join(", ")}. Using deterministic fallback summary.`,
      ),
    };
  }

  try {
    const provider = config.aiSummaryProvider!;
    const modelName = config.aiSummaryModel!;
    const apiKey = config.aiSummaryApiKey!;

    const model = aiModelFactory({
      provider,
      model: modelName,
      apiKey,
      timeoutMs: config.requestTimeoutMs,
    });

    const response = await model.complete([
      new Message("system", AI_SUMMARY_SYSTEM_PROMPT),
      new Message(
        "user",
        [
          "Summarize this impact analysis for a pull request in 1-2 concise sentences.",
          "Return JSON only in this exact schema:",
          '{"summary":"string"}',
          "Do not include markdown or extra keys.",
          `Input payload: ${JSON.stringify({
            task: "summarize-impact-analysis",
            payload: impactSeed,
          })}`,
        ].join("\n"),
      ),
    ]);

    if (response.type !== "text") {
      return {
        warning: formatWarning("AI_SUMMARY_FAILED", "AI summary response did not contain text output."),
      };
    }

    const summary = parseSummaryFromModelContent(response.content ?? "");
    if (!summary) {
      return {
        warning: formatWarning("AI_SUMMARY_FAILED", "AI summary model returned no summary text."),
      };
    }

    return { summary };
  } catch (error) {
    return {
      warning: formatWarning("AI_SUMMARY_FAILED", `AI summary request failed: ${String(error)}`),
    };
  }
}
