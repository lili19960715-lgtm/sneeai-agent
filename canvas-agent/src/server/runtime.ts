import type { Server } from "node:http";

import { loadConfig, type CanvasAgentConfig } from "../config.js";
import { probeAgent, type AgentProbeResult } from "../pairing.js";
import { startHttpServer } from "./http.js";

const RACE_TIMEOUT_MS = 4_000;
const RACE_RETRY_MS = 50;

/** 确保插件 MCP 进程可以复用或拥有一个同版本本机 HTTP 桥接。 */
export async function ensurePluginHttpServer(): Promise<Server | null> {
    const config = loadConfig(true);
    const current = await probeAgent(config);
    if (current === "ready") return null;
    if (current !== "offline") throw agentStatusError(current);

    const server = startHttpServer({ silent: true });
    try {
        await waitForListening(server);
        return server;
    } catch (error) {
        if (!isAddressInUse(error)) throw error;
        const raced = await waitForReadyAgent(config);
        if (raced === "ready") return null;
        throw agentStatusError(raced);
    }
}

function waitForListening(server: Server) {
    if (server.listening) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        const onListening = () => {
            cleanup();
            resolve();
        };
        const onError = (error: Error) => {
            cleanup();
            reject(error);
        };
        const cleanup = () => {
            server.off("listening", onListening);
            server.off("error", onError);
        };
        server.once("listening", onListening);
        server.once("error", onError);
    });
}

async function waitForReadyAgent(config: CanvasAgentConfig): Promise<AgentProbeResult> {
    const deadline = Date.now() + RACE_TIMEOUT_MS;
    let status: AgentProbeResult = "offline";
    while (Date.now() < deadline) {
        status = await probeAgent(config);
        if (status !== "offline") return status;
        await new Promise((resolve) => setTimeout(resolve, RACE_RETRY_MS));
    }
    return status;
}

function agentStatusError(status: AgentProbeResult) {
    if (status === "unauthorized") return new Error("本机端口已有 Sneeai Agent，但 Connect token 与当前插件配置不一致。请停止旧 Agent 后重试。");
    if (status === "incompatible") return new Error("本机端口被其他服务或不同版本的 Sneeai Agent 占用。请停止该进程后重试。");
    return new Error("Sneeai Agent 本机桥接启动失败");
}

function isAddressInUse(error: unknown) {
    return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}
