const test = require("node:test");
const assert = require("node:assert/strict");
const { computeImpactSummary } = require("../dist/action/impact/classifier.js");

test("computeImpactSummary marks risk high for critical tagged asset", () => {
  const summary = computeImpactSummary({
    changedEntities: [
      {
        sourceKind: "sql",
        sourceFile: "models/orders.sql",
        fqn: "warehouse.analytics.orders",
        rawReference: "orders",
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
            tags: ["critical"],
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
    riskWeighting: {
      governance: 0,
      usage: 0,
      dataQuality: 0,
      mediumThreshold: 6,
      highThreshold: 12,
    },
    truncated: false,
  });

  assert.equal(summary.riskLevel, "high");
});
