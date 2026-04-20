const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("@actions/core");
const github = require("@actions/github");
const { run } = require("../dist/action/index.js");
const { DiffReader } = require("../dist/action/github/diffReader.js");
const publish = require("../dist/action/comment/publish.js");

test("run degrades gracefully when PR comment publish fails", async () => {
  const originalGetInput = core.getInput;
  const originalGetBooleanInput = core.getBooleanInput;
  const originalSetSecret = core.setSecret;
  const originalSetOutput = core.setOutput;
  const originalSetFailed = core.setFailed;
  const originalGithubStepSummary = process.env.GITHUB_STEP_SUMMARY;

  const originalGetOctokit = github.getOctokit;
  const originalReadPullRequestDiff = DiffReader.prototype.readPullRequestDiff;
  const originalUpsertImpactComment = publish.upsertImpactComment;

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

  const stepSummaryPath = path.join(__dirname, ".tmp-step-summary-publish-failure.md");
  fs.writeFileSync(stepSummaryPath, "", "utf8");
  process.env.GITHUB_STEP_SUMMARY = stepSummaryPath;

  github.getOctokit = () => ({
    paginate: async () => [],
  });
  DiffReader.prototype.readPullRequestDiff = async () => ({
    prNumber: 77,
    headSha: "headsha",
    baseSha: "basesha",
    files: [
      {
        path: "queries/notes.sql",
        status: "modified",
        patch: "@@\n+-- comment only line\n".repeat(12),
        content: "-- comment only line",
      },
    ],
  });

  publish.upsertImpactComment = async () => {
    const error = new Error("forbidden");
    error.status = 403;
    throw error;
  };

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
    publish.upsertImpactComment = originalUpsertImpactComment;
  }

  assert.equal(failedMessage, "");
  assert.equal(outputs["analysis-status"], "partial");
  assert.equal(outputs["risk-level"], "low");
  assert.equal(outputs["changed-entity-count"], "0");
  assert.equal(outputs["warning-count"], "1");

  const warningCodeCounts = JSON.parse(outputs["warning-code-counts"]);
  assert.equal(warningCodeCounts.COMMENT_PUBLISH_FAILED, 1);
  assert.ok(outputs["impact-json"].includes("COMMENT_PUBLISH_FAILED"));
});
