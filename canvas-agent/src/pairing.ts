import { spawn } from "node:child_process";

import { AGENT_SERVICE, VERSION, type CanvasAgentConfig } from "./config.js";
import { isProtocolCompatible, REQUIRED_PAIRING_CAPABILITIES, REQUIRED_RUNTIME_CAPABILITIES } from "./protocol.js";
import { isRuntimeClaim } from "./server/runtime-claim.js";

export const DEFAULT_CANVAS_URL = "https://sneeai.com/canvas?mode=new";
const AGENT_PROBE_TIMEOUT_MS = 3_000;

/** 生成只携带本机地址的画布 URL；Connect token 永远不进入 URL。 */
export function canvasConnectionUrl(value: string, config: CanvasAgentConfig) {
    const url = new URL(value || DEFAULT_CANVAS_URL);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("画布地址只支持 HTTP 或 HTTPS");
    if (!url.searchParams.has("mode")) url.searchParams.set("mode", "new");
    url.searchParams.delete("agentUrl");
    url.searchParams.delete("agentToken");
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    fragment.delete("agentToken");
    fragment.set("agentUrl", config.url);
    url.hash = fragment.toString();
    return url.toString();
}

/** 使用系统默认浏览器打开已经带本机连接信息的画布。 */
export function openExternalUrl(url: string) {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
    const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
    return new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
        child.once("error", reject);
    });
}

export type AgentProbeResult = "ready" | "provider-blocked" | "api-key-required" | "unauthorized" | "incompatible" | "offline";
export type AgentRuntimeProbeResult = { status: "ready"; fingerprint: string; busy: boolean; claim?: string } | { status: Exclude<AgentProbeResult, "ready"> };
export type AgentHandoffResult = "accepted" | "busy" | "same" | "stale" | Exclude<AgentProbeResult, "ready">;

/** 检查当前配置是否能通过正在运行的本机 HTTP Agent 鉴权。 */
export async function probeAgent(config: CanvasAgentConfig): Promise<AgentProbeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AGENT_PROBE_TIMEOUT_MS);
    let reachable = false;
    try {
        const health = await fetch(`${config.url}/health`, { signal: controller.signal });
        reachable = true;
        const body = (await health.json().catch(() => null)) as { ok?: boolean; service?: string; version?: string; protocolVersion?: unknown; capabilities?: unknown; buildVersion?: string } | null;
        if (!health.ok || body?.ok !== true || body.service !== AGENT_SERVICE || !isProtocolCompatible(body, { requiredCapabilities: REQUIRED_PAIRING_CAPABILITIES, legacyBuildVersion: VERSION })) return "incompatible";
        const auth = await fetch(`${config.url}/agent/codex/workspace`, { headers: { "x-canvas-agent-token": config.token }, signal: controller.signal });
        const authBody = (await auth.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
        if (auth.status === 403 && authBody?.code === "codex_provider_not_allowed") return "provider-blocked";
        if (auth.status === 428 && authBody?.code === "relay_api_key_required") return "api-key-required";
        if (auth.status === 401 || auth.status === 403) return "unauthorized";
        return auth.ok && authBody?.ok === true ? "ready" : "incompatible";
    } catch {
        return reachable ? "incompatible" : "offline";
    } finally {
        clearTimeout(timer);
    }
}

/** 读取受保护的 Agent 启动指纹和忙碌状态。 */
export async function probeAgentRuntime(config: CanvasAgentConfig): Promise<AgentRuntimeProbeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AGENT_PROBE_TIMEOUT_MS);
    let reachable = false;
    try {
        const health = await fetch(`${config.url}/health`, { signal: controller.signal });
        reachable = true;
        const healthBody = (await health.json().catch(() => null)) as { ok?: boolean; service?: string; version?: string; protocolVersion?: unknown; capabilities?: unknown; buildVersion?: string } | null;
        if (!health.ok || healthBody?.ok !== true || healthBody.service !== AGENT_SERVICE || !isProtocolCompatible(healthBody, { requiredCapabilities: REQUIRED_RUNTIME_CAPABILITIES, legacyBuildVersion: VERSION })) return { status: "incompatible" };
        const runtime = await fetch(`${config.url}/agent/runtime`, { headers: { "x-canvas-agent-token": config.token }, signal: controller.signal });
        if (runtime.status === 401 || runtime.status === 403) return { status: "unauthorized" };
        const body = (await runtime.json().catch(() => null)) as { ok?: boolean; fingerprint?: string; busy?: boolean; claim?: string } | null;
        if (!runtime.ok || body?.ok !== true || !isRuntimeFingerprint(body.fingerprint) || typeof body.busy !== "boolean" || (body.claim !== undefined && !isRuntimeClaim(body.claim))) return { status: "incompatible" };
        return { status: "ready", fingerprint: body.fingerprint, busy: body.busy, ...(typeof body.claim === "string" ? { claim: body.claim } : {}) };
    } catch {
        return { status: reachable ? "incompatible" : "offline" };
    } finally {
        clearTimeout(timer);
    }
}

/** 请求同版本、同 token 的旧 Agent 将空闲桥接交给当前 MCP。 */
export async function requestAgentHandoff(config: CanvasAgentConfig, fingerprint: string, claim: string): Promise<AgentHandoffResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    try {
        const response = await fetch(`${config.url}/agent/runtime/handoff`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-canvas-agent-token": config.token },
            body: JSON.stringify({ fingerprint, claim }),
            signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) return "unauthorized";
        const body = (await response.json().catch(() => null)) as { ok?: boolean; handoff?: boolean; busy?: boolean; stale?: boolean } | null;
        if (response.status === 409 && body?.busy) return "busy";
        if (response.status === 409 && body?.stale) return "stale";
        if (response.status === 202 && body?.ok && body.handoff) return "accepted";
        if (response.ok && body?.ok && body.handoff === false) return "same";
        return "incompatible";
    } catch {
        return "offline";
    } finally {
        clearTimeout(timer);
    }
}

function isRuntimeFingerprint(value: unknown): value is string {
    return typeof value === "string" && /^v1:[a-f0-9]{64}$/.test(value);
}
