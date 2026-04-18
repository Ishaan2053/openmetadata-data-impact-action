const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeAnalysisStatus,
  countWarningCode,
  extractWarningCode,
  extractWarningCodes,
  formatWarning,
  hasWarningCode,
  warningCodeCounts,
} = require("../dist/action/warnings.js");

test("warning taxonomy extracts codes and counts correctly", () => {
  const warnings = [
    formatWarning("METADATA_MISSING", "Missing metadata for orders."),
    formatWarning("PARSE_FAILED", "Failed to parse models/orders.sql"),
    formatWarning("METADATA_MISSING", "Missing metadata for customers."),
    "legacy warning without code",
  ];

  assert.equal(extractWarningCode(warnings[0]), "METADATA_MISSING");
  assert.equal(extractWarningCode(warnings[3]), undefined);
  assert.deepEqual(extractWarningCodes(warnings).sort(), ["METADATA_MISSING", "PARSE_FAILED"]);
  assert.equal(countWarningCode(warnings, "METADATA_MISSING"), 2);
  assert.equal(hasWarningCode(warnings, "PARSE_FAILED"), true);

  const counts = warningCodeCounts(warnings);
  assert.equal(counts.METADATA_MISSING, 2);
  assert.equal(counts.PARSE_FAILED, 1);
  assert.equal(counts.NETWORK_ERROR, undefined);
});

test("analysis status is degraded for transport failures", () => {
  const warnings = [formatWarning("NETWORK_ERROR", "Lineage request failed")];
  assert.equal(computeAnalysisStatus(warnings, false), "degraded");
});

test("analysis status is partial for metadata and truncation signals", () => {
  const metadataWarnings = [formatWarning("METADATA_MISSING", "Missing metadata")];
  assert.equal(computeAnalysisStatus(metadataWarnings, false), "partial");

  const noWarnings = [];
  assert.equal(computeAnalysisStatus(noWarnings, true), "partial");
});

test("analysis status is success when no warning codes and no truncation", () => {
  assert.equal(computeAnalysisStatus([], false), "success");
});
