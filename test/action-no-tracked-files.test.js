const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("@actions/core");
const github = require("@actions/github");
const { run } = require("../dist/action/index.js");
const { DiffReader } = require("../dist/action/github/diffReader.js");

test("run marks analysis as skipped when no tracked files are changed", async () => {
  const originalGetInput = core.getInput;
  const originalGetBooleanInput = core.getBooleanInput;
  const originalSetSecret = core.setSecret;
  const originalSetOutput = core.setOutput;
  const originalSetFailed = core.setFailed;
  const originalGithubStepSummary = process.env.GITHUB_STEP_SUMMARY;

  const originalGetOctokit = github.getOctokit;
  const originalReadPullRequestDiff = DiffReader.prototype.readPullRequestDiff;

  const outputs = {};
  let failedMessage = "";

  core.getInput = (name) => {
    if (name === "openmetadata-endpoint") {
      return "https://metadata.example.com";
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

  const stepSummaryPath = path.join(__dirname, ".tmp-step-summary.md");
  fs.writeFileSync(stepSummaryPath, "", "utf8");
  process.env.GITHUB_STEP_SUMMARY = stepSummaryPath;

  github.getOctokit = () => ({
    paginate: async () => [],
  });
  DiffReader.prototype.readPullRequestDiff = async () => ({
    prNumber: 11,
    headSha: "headsha",
    baseSha: "basesha",
    files: [],
  });

  try {
    await run();
  } finally {
    core.getInput = originalGetInput;
    core.getBooleanInput = originalGetBooleanInput;
    core.setSecret = originalSetSecret;
    core.setOutput = originalSetOutput;
    core.setFailed = originalSetFailed;

    if (originalGithubStepSummary === undefined) {
      delete process.env.GITHUB_STEP_SUMMARY;
    } else {
      process.env.GITHUB_STEP_SUMMARY = originalGithubStepSummary;
    }
    if (fs.existsSync(stepSummaryPath)) {
      fs.unlinkSync(stepSummaryPath);
    }

    github.getOctokit = originalGetOctokit;
    DiffReader.prototype.readPullRequestDiff = originalReadPullRequestDiff;
  }

  assert.equal(failedMessage, "");
  assert.equal(outputs["analysis-status"], "skipped");
  assert.equal(outputs["risk-level"], "low");
  assert.equal(outputs["impacted-asset-count"], "0");
  assert.equal(outputs["warning-count"], "0");
  assert.equal(outputs["changed-entity-count"], "0");
  assert.equal(outputs["low-confidence-entity-count"], "0");
  assert.equal(outputs["truncated-analysis"], "false");
});
