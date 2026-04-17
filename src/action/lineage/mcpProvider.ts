import { ActionConfig, CanonicalEntity, LineageNode, LineageResult } from "../types";
import { LineageProvider } from "./provider";

interface McpResponse {
  nodes?: Array<{
    id?: string;
    fqn?: string;
    name?: string;
    type?: string;
    url?: string;
    tags?: string[];
  }>;
  warnings?: string[];
  partial?: boolean;
}

function mapType(raw: string | undefined): LineageNode["type"] {
  const lower = (raw ?? "").toLowerCase();
  if (lower.includes("dashboard")) {
    return "dashboard";
  }
  if (lower.includes("pipeline")) {
    return "pipeline";
  }
  if (lower.includes("report")) {
    return "report";
  }
  if (lower.includes("view")) {
    return "view";
  }
  if (lower.includes("table")) {
    return "table";
  }
  if (lower.includes("topic")) {
    return "topic";
  }
  return "other";
}

export class McpLineageProvider implements LineageProvider {
  readonly name = "mcp-http-adapter";

  constructor(private readonly config: ActionConfig) {}

  async getDownstream(entity: CanonicalEntity, depth: number): Promise<LineageResult> {
    if (!this.config.mcpEndpoint) {
      return {
        sourceEntityFqn: entity.fqn,
        nodes: [],
        partial: true,
        warnings: ["MCP lineage provider selected, but mcp-endpoint is not configured."],
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(this.config.mcpEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.authToken}`,
        },
        body: JSON.stringify({
          action: "lineage",
          entity: {
            fqn: entity.fqn,
            table: entity.table,
            schema: entity.schema,
            database: entity.database,
            column: entity.column,
          },
          depth,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          sourceEntityFqn: entity.fqn,
          nodes: [],
          partial: true,
          warnings: [`MCP provider request failed with status ${response.status}.`],
        };
      }

      const body = (await response.json()) as McpResponse;
      const nodes: LineageNode[] = [];
      for (const node of body.nodes ?? []) {
        if (!node.id || !node.fqn || !node.name) {
          continue;
        }

        const mapped: LineageNode = {
          id: node.id,
          fqn: node.fqn,
          name: node.name,
          type: mapType(node.type),
          upstreamFrom: entity.fqn,
        };

        if (node.url) {
          mapped.url = node.url;
        }

        if (Array.isArray(node.tags) && node.tags.length > 0) {
          mapped.tags = node.tags.map((tag) => tag.toLowerCase());
        }

        nodes.push(mapped);
      }

      return {
        sourceEntityFqn: entity.fqn,
        nodes,
        partial: body.partial ?? false,
        warnings: body.warnings ?? [],
      };
    } catch (error) {
      return {
        sourceEntityFqn: entity.fqn,
        nodes: [],
        partial: true,
        warnings: [`MCP provider request failed: ${String(error)}`],
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
