const test = require("node:test");
const assert = require("node:assert/strict");
const github = require("@actions/github");
const { upsertImpactComment } = require("../dist/action/comment/publish.js");

const MARKER = "<!-- openmetadata-impact-analysis -->";

async function withGithubMock(mockOptions, fn) {
  const originalGetOctokit = github.getOctokit;
  const originalContext = github.context;

  const calls = {
    update: [],
    create: [],
  };

  const octokit = {
    rest: {
      users: {
        getAuthenticated: async () => {
          if (mockOptions.authError) {
            throw Object.assign(new Error("auth failed"), { status: 401 });
          }
          return { data: { login: mockOptions.authLogin ?? "impact-bot" } };
        },
      },
      issues: {
        updateComment: async (payload) => {
          calls.update.push(payload);
          return { data: { id: payload.comment_id } };
        },
        createComment: async (payload) => {
          calls.create.push(payload);
          return { data: { id: 999 } };
        },
      },
    },
    paginate: async () => mockOptions.comments ?? [],
  };

  github.getOctokit = () => octokit;
  github.context = {
    repo: {
      owner: "example-owner",
      repo: "example-repo",
    },
  };

  try {
    await fn(calls);
  } finally {
    github.getOctokit = originalGetOctokit;
    github.context = originalContext;
  }
}

test("upsertImpactComment updates existing authored marker comment", async () => {
  await withGithubMock(
    {
      authLogin: "impact-bot",
      comments: [
        {
          id: 42,
          body: `${MARKER}\nold body`,
          user: { login: "impact-bot", type: "Bot" },
        },
      ],
    },
    async (calls) => {
      await upsertImpactComment("ghs_test", 123, "new analysis body");

      assert.equal(calls.update.length, 1);
      assert.equal(calls.create.length, 0);
      assert.equal(calls.update[0].comment_id, 42);
      assert.ok(calls.update[0].body.includes(MARKER));
      assert.ok(calls.update[0].body.includes("new analysis body"));
    },
  );
});

test("upsertImpactComment creates new comment when no marker comment exists", async () => {
  await withGithubMock(
    {
      authLogin: "impact-bot",
      comments: [
        {
          id: 99,
          body: "a normal reviewer comment",
          user: { login: "reviewer", type: "User" },
        },
      ],
    },
    async (calls) => {
      await upsertImpactComment("ghs_test", 456, "impact body");

      assert.equal(calls.update.length, 0);
      assert.equal(calls.create.length, 1);
      assert.ok(calls.create[0].body.includes(MARKER));
      assert.ok(calls.create[0].body.includes("impact body"));
    },
  );
});

test("upsertImpactComment creates a new comment when auth lookup fails", async () => {
  await withGithubMock(
    {
      authError: true,
      comments: [
        {
          id: 77,
          body: `${MARKER}\nexisting`,
          user: { login: "some-bot", type: "Bot" },
        },
      ],
    },
    async (calls) => {
      await upsertImpactComment("ghs_test", 789, "replacement");

      assert.equal(calls.update.length, 0);
      assert.equal(calls.create.length, 1);
      assert.ok(calls.create[0].body.includes("replacement"));
    },
  );
});
