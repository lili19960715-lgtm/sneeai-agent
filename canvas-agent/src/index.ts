#!/usr/bin/env node
import { ensureHttpAgent, openCanvasWithRunningAgent, startHttpServer } from "./server/http.js";
import { startMcpServer } from "./server/mcp.js";
import { VERSION } from "./config.js";

if (process.argv[2] === "mcp") {
    await ensureHttpAgent();
    await startMcpServer();
}
else if (process.argv[2] === "open") await openCanvasWithRunningAgent(process.argv[3] || "https://sneeai.com/canvas?mode=new");
else if (process.argv[2] === "version") console.log(VERSION);
else if (process.argv[2] === "doctor") {
    try {
        const config = await ensureHttpAgent();
        console.log(JSON.stringify({ ok: true, platform: process.platform, node: process.version, agentVersion: VERSION, agentUrl: config.url, agentReachable: true }, null, 2));
    } catch (error) {
        console.error(JSON.stringify({ ok: false, platform: process.platform, node: process.version, agentVersion: VERSION, error: error instanceof Error ? error.message : String(error) }, null, 2));
        process.exitCode = 1;
    }
}
else startHttpServer();
