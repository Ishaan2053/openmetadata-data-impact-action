const test = require("node:test");
const assert = require("node:assert/strict");
const { truncateForStepSummary } = require("../dist/action/comment/summary.js");

test("truncateForStepSummary leaves short markdown unchanged", () => {
  const markdown = "## Data Impact Analysis\n\nAll good.";
  const result = truncateForStepSummary(markdown, 1024);

  assert.equal(result.truncated, false);
  assert.equal(result.markdown, markdown);
});

test("truncateForStepSummary enforces byte cap and appends truncation notice", () => {
  const markdown = `## Full Data Impact Report\n\n${"line item\n".repeat(200)}`;
  const maxBytes = 220;
  const result = truncateForStepSummary(markdown, maxBytes);

  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.markdown, "utf8") <= maxBytes);
  assert.ok(result.markdown.includes("Summary truncated to fit GitHub Actions step summary limit"));
});
