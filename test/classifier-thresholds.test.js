const test = require("node:test");
const assert = require("node:assert/strict");
const { computeImpactSummary } = require("../dist/action/impact/classifier.js");
const { formatWarning } = require("../dist/action/warnings.js");

function seedInput(overrides = {}) {
  return {
    changedEntities: [
      {
        sourceKind: "sql",
        sourceFile: "models/orders.sql",
        fqn: "warehouse.analytics.orders",
        rawReference: "warehouse.analytics.orders",
        table: "orders",
        confidence: "high",
      },
    ],
    lineageResults: [
      {
        sourceEntityFqn: "warehouse.analytics.orders",
        nodes: [
          {
            id: "dash-1",
            fqn: "bi.dashboard.revenue",
            name: "Revenue Dashboard",
            type: "dashboard",
          },
        ],
        partial: false,
        warnings: [],
      },
    ],
    warnings: [],
    lowConfidenceEntityCount: 0,
    criticalAssetTags: ["critical"],
    riskThresholds: {
      dashboardHigh: 5,
      pipelineHigh: 4,
      reportHigh: 8,
      totalHigh: 20,
      warningCountHigh: 3,
      warningMinAssetsHigh: 8,
      lowConfidenceHigh: 10,
    },
    truncated: false,
    ...overrides,
  };
}

test("computeImpactSummary applies configurable dashboard high-risk threshold", () => {
  const summary = computeImpactSummary(
    seedInput({
      riskThresholds: {
        dashboardHigh: 1,
        pipelineHigh: 99,
        reportHigh: 99,
        totalHigh: 99,
        warningCountHigh: 99,
        warningMinAssetsHigh: 99,
        lowConfidenceHigh: 99,
      },
    }),
  );

  assert.equal(summary.riskLevel, "high");
});

test("computeImpactSummary remains medium when custom high thresholds are not met", () => {
  const summary = computeImpactSummary(
    seedInput({
      riskThresholds: {
        dashboardHigh: 10,
        pipelineHigh: 10,
        reportHigh: 10,
        totalHigh: 50,
        warningCountHigh: 10,
        warningMinAssetsHigh: 20,
        lowConfidenceHigh: 50,
      },
    }),
  );

  assert.equal(summary.riskLevel, "medium");
});

test("computeImpactSummary adds missing metadata suggestion only for coded taxonomy warnings", () => {
  const uncodedSummary = computeImpactSummary(
    seedInput({
      warnings: ["Missing metadata for warehouse.analytics.orders"],
      lineageResults: [],
    }),
  );
  assert.ok(
    !uncodedSummary.suggestions.includes(
      "Add or repair missing OpenMetadata entities to improve lineage coverage.",
    ),
  );

  const codedSummary = computeImpactSummary(
    seedInput({
      warnings: [
        formatWarning("METADATA_MISSING", "Missing metadata for warehouse.analytics.orders"),
      ],
      lineageResults: [],
    }),
  );
  assert.ok(
    codedSummary.suggestions.includes(
      "Add or repair missing OpenMetadata entities to improve lineage coverage.",
    ),
  );
});
