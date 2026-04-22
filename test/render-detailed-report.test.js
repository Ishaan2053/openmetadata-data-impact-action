const test = require("node:test");
const assert = require("node:assert/strict");
const {
  renderDetailedImpactReport,
} = require("../dist/action/comment/render.js");

test("detailed report includes truncation and confidence signals", () => {
  const summary = {
    riskLevel: "medium",
    changedEntityCount: 4,
    lowConfidenceEntityCount: 2,
    impactedAssetCount: 1,
    warnings: ["sample warning"],
    impactedByType: {
      dashboard: [
        {
          id: "1",
          fqn: "bi.dashboard.revenue",
          name: "Revenue Dashboard",
          type: "dashboard",
          reasons: ["Downstream of warehouse.analytics.orders"],
        },
      ],
      pipeline: [],
      report: [],
      table: [],
      view: [],
      topic: [],
      other: [],
    },
    suggestions: ["Validate downstream assets in staging."],
    truncated: true,
  };

  const config = {
    criticalAssetTags: ["critical"],
    maxCommentAssets: 20,
  };

  const markdown = renderDetailedImpactReport(summary, config);
  assert.ok(markdown.includes("| Truncated analysis | **yes** |"));
  assert.ok(markdown.includes("| Low-confidence entities | **2** |"));
});
