const test = require("node:test");
const assert = require("node:assert/strict");
const { renderImpactComment } = require("../dist/action/comment/render.js");

test("renderImpactComment sanitizes markdown, disables unsafe links, and neutralizes mentions", () => {
  const summary = {
    riskLevel: "medium",
    changedEntityCount: 1,
    lowConfidenceEntityCount: 0,
    impactedAssetCount: 1,
    whatChanged: ["orders.sql: add @data-team [unsafe](javascript:alert(1))"],
    warnings: ["[METADATA_MISSING] Ping @owners [link](javascript:alert(2))"],
    impactedByType: {
      dashboard: [
        {
          id: "dash-1",
          fqn: "bi.dashboard.revenue",
          name: "Revenue [unsafe] @ops",
          type: "dashboard",
          url: "javascript:alert(3)",
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
    suggestions: ["Notify @data-team before merge"],
    truncated: false,
  };

  const config = {
    criticalAssetTags: ["critical"],
    maxCommentAssets: 20,
  };

  const markdown = renderImpactComment(summary, config);

  assert.ok(markdown.includes("&#64;data-team"));
  assert.ok(markdown.includes("&#64;owners"));
  assert.ok(markdown.includes("&#64;ops"));
  assert.ok(!markdown.includes("javascript:alert"));
  assert.ok(markdown.includes("Revenue \\[unsafe\\] &#64;ops"));
});
