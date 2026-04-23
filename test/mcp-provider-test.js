const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OpenMetadataMcpLineageProvider,
} = require("../dist/action/lineage/openmetadataMcpProvider.js");

function createConfig(overrides = {}) {
  return {
    openMetadataEndpoint: "https://metadata.example.com",
    authToken: "token",
    githubToken: "ghs_test",
    operatingMode: "balanced",
    filePatterns: ["**/*.sql"],
    lineageProvider: "mcp",
    mcpEndpoint: "https://metadata.example.com/mcp",
    maxLineageDepth: 3,
    maxConcurrency: 4,
    maxTrackedFiles: 200,
    maxEntities: 500,
    maxDownstreamAssets: 2000,
    requestTimeoutMs: 1000,
    maxRetries: 0,
    maxRetryWaitMs: 15000,
    maxTotalRetryWaitMs: 60000,
    failOnMissingMetadata: false,
    aiSummaryEnabled: false,
    strictSqlParse: false,
    criticalAssetTags: ["critical"],
    riskThresholds: {
      dashboardHigh: 5,
      pipelineHigh: 4,
      reportHigh: 8,
      totalHigh: 20,
      warningCountHigh: 3,
      warningMinAssetsHigh: 8,
      lowConfidenceHigh: 10,
    },
    riskWeighting: {
      governance: 0,
      usage: 0,
      dataQuality: 0,
      mediumThreshold: 6,
      highThreshold: 12,
    },
    allowedEndpointHosts: [],
    allowInsecureLocalEndpoints: false,
    maxCommentAssets: 20,
    ...overrides,
  };
}

function createEntity() {
  return {
    sourceKind: "sql",
    sourceFile: "models/orders.sql",
    rawReference: "warehouse.analytics.orders",
    fqn: "warehouse.analytics.orders",
    table: "orders",
    schema: "analytics",
    database: "warehouse",
    confidence: "high",
  };
}

test("OpenMetadataMcpLineageProvider uses official JSON-RPC methods and maps lineage/details", async () => {
  const originalFetch = global.fetch;
  const methods = [];

  global.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    methods.push(payload.method);

    if (payload.method === "initialize") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            protocolVersion: "2024-11-05",
          },
        }),
      };
    }

    if (payload.method === "tools/list") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            tools: [
              { name: "get_entity_lineage" },
              { name: "get_entity_details" },
              { name: "search_metadata" },
            ],
          },
        }),
      };
    }

    if (payload.method === "tools/call" && payload.params?.name === "get_entity_lineage") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            structuredContent: {
              downstreamNodes: [
                {
                  id: "dash-1",
                  fullyQualifiedName: "bi.dashboard.revenue",
                  name: "Revenue Dashboard",
                  type: "dashboard",
                  tags: ["critical"],
                },
              ],
            },
          },
        }),
      };
    }

    if (payload.method === "tools/call" && payload.params?.name === "get_entity_details") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            structuredContent: {
              owners: ["finance-team"],
              tags: ["business_critical"],
              domain: "finance",
            },
          },
        }),
      };
    }

    throw new Error(`Unexpected MCP call: ${JSON.stringify(payload)}`);
  };

  try {
    const provider = new OpenMetadataMcpLineageProvider(createConfig());
    const result = await provider.getDownstream(createEntity(), 2);

    assert.deepEqual(methods.slice(0, 3), ["initialize", "tools/list", "tools/call"]);
    assert.equal(result.partial, false);
    assert.equal(result.nodes.length, 1);
    assert.equal(result.nodes[0].fqn, "bi.dashboard.revenue");
    assert.ok(result.nodes[0].tags.includes("critical"));
    assert.ok(result.nodes[0].tags.includes("business_critical"));
    assert.deepEqual(result.nodes[0].owners, ["finance-team"]);
    assert.equal(result.nodes[0].domain, "finance");
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenMetadataMcpLineageProvider caches initialize/tools list across multiple requests", async () => {
  const originalFetch = global.fetch;
  let initializeCalls = 0;
  let toolsListCalls = 0;
  let toolCallCount = 0;

  global.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));

    if (payload.method === "initialize") {
      initializeCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            protocolVersion: "2024-11-05",
          },
        }),
      };
    }

    if (payload.method === "tools/list") {
      toolsListCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            tools: [{ name: "get_entity_lineage" }],
          },
        }),
      };
    }

    if (payload.method === "tools/call") {
      toolCallCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            structuredContent: {
              downstreamNodes: [
                {
                  id: `tbl-${toolCallCount}`,
                  fullyQualifiedName: `warehouse.analytics.orders_${toolCallCount}`,
                  name: `orders_${toolCallCount}`,
                  type: "table",
                },
              ],
            },
          },
        }),
      };
    }

    throw new Error(`Unexpected MCP call: ${JSON.stringify(payload)}`);
  };

  try {
    const provider = new OpenMetadataMcpLineageProvider(createConfig());
    await provider.getDownstream(createEntity(), 1);
    await provider.getDownstream(createEntity(), 2);

    assert.equal(initializeCalls, 1);
    assert.equal(toolsListCalls, 1);
    assert.equal(toolCallCount, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenMetadataMcpLineageProvider returns AUTH_ERROR when MCP responds with authentication error", async () => {
  const originalFetch = global.fetch;

  global.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));

    if (payload.method === "initialize") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            protocolVersion: "2024-11-05",
          },
        }),
      };
    }

    if (payload.method === "tools/list") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            tools: [{ name: "get_entity_lineage" }],
          },
        }),
      };
    }

    if (payload.method === "tools/call") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: payload.id,
          error: {
            code: -32002,
            message: "Authentication required",
          },
        }),
      };
    }

    throw new Error(`Unexpected MCP call: ${JSON.stringify(payload)}`);
  };

  try {
    const provider = new OpenMetadataMcpLineageProvider(createConfig());
    const result = await provider.getDownstream(createEntity(), 1);

    assert.equal(result.nodes.length, 0);
    assert.equal(result.partial, true);
    assert.ok(result.warnings.some((warning) => warning.includes("[AUTH_ERROR]")));
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenMetadataMcpLineageProvider retries transient failures and records observability counters", async () => {
  const originalFetch = global.fetch;
  let initializeCalls = 0;

  global.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));

    if (payload.method === "initialize") {
      initializeCalls += 1;
      if (initializeCalls === 1) {
        return {
          ok: false,
          status: 503,
          headers: {
            get(name) {
              return name.toLowerCase() === "retry-after" ? "0" : null;
            },
          },
        };
      }

      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            protocolVersion: "2024-11-05",
          },
        }),
      };
    }

    if (payload.method === "tools/list") {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            tools: [{ name: "get_entity_lineage" }],
          },
        }),
      };
    }

    if (payload.method === "tools/call") {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            structuredContent: {
              downstreamNodes: [],
            },
          },
        }),
      };
    }

    throw new Error(`Unexpected MCP call: ${JSON.stringify(payload)}`);
  };

  try {
    const provider = new OpenMetadataMcpLineageProvider(
      createConfig({ maxRetries: 1, maxRetryWaitMs: 0, maxTotalRetryWaitMs: 0 }),
    );
    const result = await provider.getDownstream(createEntity(), 1);
    const counters = provider.getObservabilityCounters();

    assert.equal(result.partial, false);
    assert.equal(initializeCalls, 2);
    assert.ok(counters.retryAttempts >= 1);
    assert.ok(counters.requests >= 4);
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenMetadataMcpLineageProvider returns retry budget exhausted warning when budget is depleted", async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: false,
    status: 503,
    headers: {
      get(name) {
        return name.toLowerCase() === "retry-after" ? "10" : null;
      },
    },
  });

  try {
    const provider = new OpenMetadataMcpLineageProvider(
      createConfig({ maxRetries: 1, maxRetryWaitMs: 1000, maxTotalRetryWaitMs: 0 }),
    );
    const result = await provider.getDownstream(createEntity(), 1);
    const counters = provider.getObservabilityCounters();

    assert.equal(result.nodes.length, 0);
    assert.equal(result.partial, true);
    assert.ok(
      result.warnings.some((warning) => warning.includes("[RETRY_BUDGET_EXHAUSTED]")),
    );
    assert.ok(counters.retryBudgetExhaustions >= 1);
  } finally {
    global.fetch = originalFetch;
  }
});
