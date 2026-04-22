const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildOptionalAiSummary,
  setAiModelFactoryForTests,
} = require("../dist/action/impact/aiSummary.js");

function createConfig(overrides = {}) {
  return {
    openMetadataEndpoint: "https://metadata.example.com",
    authToken: "token",
    githubToken: "ghs_test",
    filePatterns: ["**/*.sql"],
    lineageProvider: "api",
    maxLineageDepth: 3,
    maxConcurrency: 4,
    maxTrackedFiles: 200,
    maxEntities: 500,
    maxDownstreamAssets: 2000,
    requestTimeoutMs: 500,
    maxRetries: 2,
    failOnMissingMetadata: false,
    aiSummaryEnabled: false,
    aiSummaryProvider: "openai",
    aiSummaryModel: "gpt-4.1-mini",
    aiSummaryApiKey: "test-key",
    strictSqlParse: false,
    criticalAssetTags: ["critical"],
    allowedEndpointHosts: [],
    allowInsecureLocalEndpoints: false,
    maxCommentAssets: 20,
    ...overrides,
  };
}

function impactSeed() {
  return {
    riskLevel: "high",
    changedEntityCount: 3,
    impactedAssetCount: 12,
    warnings: [],
  };
}

test("AI summary returns deterministic fallback when required LLM settings are missing", async () => {
  const result = await buildOptionalAiSummary(
    createConfig({ aiSummaryEnabled: true, aiSummaryApiKey: undefined }),
    impactSeed(),
  );

  assert.ok(result.summary.includes("Risk HIGH"));
  assert.ok(result.warning.includes("deterministic fallback"));
});

test("AI summary returns warning when provider completion throws", async () => {
  setAiModelFactoryForTests(() => ({
    complete: async () => {
      throw new Error("provider unavailable");
    },
  }));

  try {
    const result = await buildOptionalAiSummary(
      createConfig({ aiSummaryEnabled: true }),
      impactSeed(),
    );

    assert.equal(result.summary, undefined);
    assert.ok(result.warning.includes("provider unavailable"));
  } finally {
    setAiModelFactoryForTests();
  }
});

test("AI summary returns summary text on success", async () => {
  setAiModelFactoryForTests(() => ({
    complete: async () => ({
      type: "text",
      content: '{"summary":"Blast radius is concentrated in BI assets."}',
    }),
  }));

  try {
    const result = await buildOptionalAiSummary(
      createConfig({ aiSummaryEnabled: true }),
      impactSeed(),
    );

    assert.equal(result.summary, "Blast radius is concentrated in BI assets.");
    assert.equal(result.warning, undefined);
  } finally {
    setAiModelFactoryForTests();
  }
});
