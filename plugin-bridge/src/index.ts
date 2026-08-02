#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { callLocalAgent, readLocalAgentConfig } from "./local-agent.js";
import { toolDescriptions, toolInputSchemas, toolNames, type ToolName } from "./schemas.js";

const server = new McpServer(
    { name: "sneeai", version: "0.1.0" },
    { instructions: "Sneeai 插件通过本机 Sneeai Agent 操作当前已连接的网站画布。" },
);

for (const name of toolNames) registerTool(name);
await server.connect(new StdioServerTransport());

function registerTool(name: ToolName) {
    const schema = toolInputSchemas[name];
    server.registerTool(name, { description: toolDescriptions[name], inputSchema: schema.shape }, async (input: unknown) => {
        const result = await callLocalAgent(readLocalAgentConfig(), name, schema.parse(input));
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    });
}
