const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const {
  DEFAULT_PATTERNS,
  DEFAULT_CRITICAL_TAGS,
  DEFAULT_OPERATING_MODE,
  DEFAULT_RISK_THRESHOLDS,
  DEFAULT_RETRY_SAFEGUARDS,
  DEFAULT_RISK_WEIGHTING,
  OPENMETADATA_MAX_LINEAGE_DEPTH,
} = require("../dist/action/config.js");

function parseMultilineDefault(value) {
  return String(value)
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

test("action.yml defaults stay in sync with runtime config defaults", () => {
  const actionYamlPath = path.join(__dirname, "..", "action.yml");
  const actionDoc = yaml.load(fs.readFileSync(actionYamlPath, "utf8"));
  const inputs = actionDoc.inputs;

  assert.deepEqual(parseMultilineDefault(inputs["file-patterns"].default), DEFAULT_PATTERNS);
  assert.deepEqual(
    parseMultilineDefault(inputs["critical-asset-tags"].default),
    DEFAULT_CRITICAL_TAGS,
  );
  assert.equal(String(inputs["operating-mode"].default), String(DEFAULT_OPERATING_MODE));
  assert.equal(String(inputs["max-lineage-depth"].default), String(OPENMETADATA_MAX_LINEAGE_DEPTH));
  assert.equal(String(inputs["max-retry-wait-ms"].default), String(DEFAULT_RETRY_SAFEGUARDS.maxRetryWaitMs));
  assert.equal(
    String(inputs["max-total-retry-wait-ms"].default),
    String(DEFAULT_RETRY_SAFEGUARDS.maxTotalRetryWaitMs),
  );

  assert.equal(String(inputs["risk-high-dashboard-count"].default), String(DEFAULT_RISK_THRESHOLDS.dashboardHigh));
  assert.equal(String(inputs["risk-high-pipeline-count"].default), String(DEFAULT_RISK_THRESHOLDS.pipelineHigh));
  assert.equal(String(inputs["risk-high-report-count"].default), String(DEFAULT_RISK_THRESHOLDS.reportHigh));
  assert.equal(String(inputs["risk-high-total-assets"].default), String(DEFAULT_RISK_THRESHOLDS.totalHigh));
  assert.equal(String(inputs["risk-high-warning-count"].default), String(DEFAULT_RISK_THRESHOLDS.warningCountHigh));
  assert.equal(String(inputs["risk-high-warning-min-assets"].default), String(DEFAULT_RISK_THRESHOLDS.warningMinAssetsHigh));
  assert.equal(String(inputs["risk-high-low-confidence-count"].default), String(DEFAULT_RISK_THRESHOLDS.lowConfidenceHigh));
  assert.equal(String(inputs["risk-weight-governance"].default), String(DEFAULT_RISK_WEIGHTING.governance));
  assert.equal(String(inputs["risk-weight-usage"].default), String(DEFAULT_RISK_WEIGHTING.usage));
  assert.equal(String(inputs["risk-weight-data-quality"].default), String(DEFAULT_RISK_WEIGHTING.dataQuality));
  assert.equal(
    String(inputs["risk-weight-medium-threshold"].default),
    String(DEFAULT_RISK_WEIGHTING.mediumThreshold),
  );
  assert.equal(
    String(inputs["risk-weight-high-threshold"].default),
    String(DEFAULT_RISK_WEIGHTING.highThreshold),
  );
});
