const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("@actions/core");
const github = require("@actions/github");
const { run } = require("../dist/action/index.js");
const { DiffReader } = require("../dist/action/github/diffReader.js");
const publish = require("../dist/action/comment/publish.js");

test("run uses MCP auto mode and falls back to OpenMetadata API when MCP is unavailable", async () => {
  const originalFetch = global.fetch;
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
  const requestedUrls = [];

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
    if (name === "lineage-provider") {
      return "auto";
    }
    if (name === "mcp-endpoint") {
      return "https://mcp.example.com/lineage";
    }
    if (name === "max-retries") {
      return "0";
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

  const stepSummaryPath = path.join(__dirname, ".tmp-step-summary-mcp-e2e.md");
  fs.writeFileSync(stepSummaryPath, "", "utf8");
  process.env.GITHUB_STEP_SUMMARY = stepSummaryPath;

  github.getOctokit = () => ({
    paginate: async () => [],
  });

  DiffReader.prototype.readPullRequestDiff = async () => ({
    prNumber: 91,
    headSha: "headsha",
    baseSha: "basesha",
    files: [
      {
        path: "models/orders.sql",
        status: "modified",
        patch: "@@\n+select * from warehouse.analytics.orders\n",
        content: "select * from warehouse.analytics.orders",
      },
    ],
  });

  publish.upsertImpactComment = async () => {};

  global.fetch = async (url, init) => {
    const target = String(url);
    requestedUrls.push(target);

    if (target.includes("mcp.example.com") && init?.method === "POST") {
      return {
        ok: false,
        status: 503,
        json: async () => ({}),
      };
    }

    if (target.includes("metadata.example.com") && init?.method === "GET") {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            downstreamNodes: [
              {
                id: "dash-1",
                fullyQualifiedName: "bi.dashboard.revenue",
                name: "Revenue Dashboard",
                type: "dashboard",
              },
            ],
          }),
        headers: {
          get() {
            return null;
          },
        },
      };
    }

    throw new Error(`unexpected fetch target: ${target}`);
  };

  try {
    await run();
  } finally {
    global.fetch = originalFetch;
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
  assert.ok(requestedUrls.some((value) => value.includes("mcp.example.com/lineage")));
  assert.ok(requestedUrls.some((value) => value.includes("/api/v1/lineage/table/name/")));
  assert.equal(outputs["risk-level"], "medium");
  assert.equal(outputs["analysis-status"], "degraded");

  const retryObservability = JSON.parse(outputs["retry-observability"]);
  assert.equal(typeof retryObservability, "object");
  assert.ok(retryObservability["fallback.requests"] >= 1);
});
