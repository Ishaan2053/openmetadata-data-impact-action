const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("@actions/core");
const { run } = require("../dist/action/index.js");

test("run emits stable baseline outputs when execution fails early", async () => {
  const originalGetInput = core.getInput;
  const originalGetBooleanInput = core.getBooleanInput;
  const originalSetSecret = core.setSecret;
  const originalSetOutput = core.setOutput;
  const originalSetFailed = core.setFailed;

  const outputs = {};
  let failedMessage = "";

  core.getInput = (name) => {
    if (name === "openmetadata-endpoint") {
      return "not-a-url";
    }
    if (name === "auth-token") {
      return "token";
    }
    if (name === "github-token") {
      return "ghs_test";
    }
    return "";
  };
  core.getBooleanInput = () => false;
  core.setSecret = () => {};
  core.setOutput = (name, value) => {
    outputs[name] = String(value);
  };
  core.setFailed = (message) => {
    failedMessage = String(message);
  };

  try {
    await run();
  } finally {
    core.getInput = originalGetInput;
    core.getBooleanInput = originalGetBooleanInput;
    core.setSecret = originalSetSecret;
    core.setOutput = originalSetOutput;
    core.setFailed = originalSetFailed;
  }

  assert.equal(outputs["analysis-status"], "failed");
  assert.equal(outputs["risk-level"], "low");
  assert.equal(outputs["impacted-asset-count"], "0");
  assert.equal(outputs["warning-count"], "0");
  assert.equal(outputs["changed-entity-count"], "0");
  assert.equal(outputs["low-confidence-entity-count"], "0");
  assert.equal(outputs["truncated-analysis"], "false");
  assert.equal(outputs["impact-json-file"], "");
  assert.ok(typeof outputs["impact-json"] === "string" && outputs["impact-json"].includes('"analysisStatus":"failed"'));
  assert.ok(failedMessage.includes("openmetadata-endpoint"));
});
