#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ServerTool } from "./tool.js";
import { deviceManagementTools } from "./tools/device-management.js";
import { screenInteractionTools, setTempDir } from "./tools/screen-interaction.js";
import { logsTools } from "./tools/logs.js";
import { reactNativeTools } from "./tools/react-native.js";
import { metroTools } from "./tools/metro.js";
import { crashTools } from "./tools/crash.js";

const allTools: ServerTool[] = [
  ...deviceManagementTools,
  ...screenInteractionTools,
  ...logsTools,
  ...reactNativeTools,
  ...metroTools,
  ...crashTools,
];

const toolMap = new Map(allTools.map((t) => [t.name, t]));

const server = new Server(
  {
    name: "android-dev-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const t = toolMap.get(name);

  if (!t) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const parsed = t._zodSchema.parse(args);
    return await t.fn(parsed);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }
});

async function main() {
  // Create temp directory for scratch files (screenshots, UI dumps)
  const tempDir = await mkdtemp(path.join(tmpdir(), "android-mcp-"));
  setTempDir(tempDir);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Android Development MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
