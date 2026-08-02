import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { logger } from "../utils/logger.js";
import { errorMessage, field } from "../utils/value.js";
import { CodexAppClient } from "./codex-client.js";
import { summarizeCodexThread, threadMessages } from "./codex-history.js";
import type { AgentAttachment, AgentEmit, AgentPermissionMode } from "./types.js";
import type { AgentCodexRuntime } from "../config.js";

type CodexRunOptions = { threadId?: string; cwd?: string; permissionMode?: AgentPermissionMode; runtime?: AgentCodexRuntime; appEmit?: AgentEmit; onStart?: () => void; onThread?: (threadId: string) => void; onTurn?: (turnId: string) => void; onFinish?: () => void };

let codexQueue: Promise<unknown> = Promise.resolve();
type RuntimeState = { app: CodexAppClient | null; appStart: Promise<CodexAppClient> | null; threadId: string; unmaterializedThreadIds: Set<string> };
const runtimes = new Map<AgentCodexRuntime, RuntimeState>();

function runtimeState(runtime: AgentCodexRuntime): RuntimeState {
    let state = runtimes.get(runtime);
    if (!state) {
        state = { app: null, appStart: null, threadId: "", unmaterializedThreadIds: new Set<string>() };
        runtimes.set(runtime, state);
    }
    return state;
}

export { summarizeCodexThread } from "./codex-history.js";

/** 将 app-server 账户响应转换成网页可用的脱敏状态。 */
export function classifyCodexAccount(account: { type?: string; planType?: string | null } | null) {
    const authMode = account?.type === "apiKey" ? "apikey" as const : account?.type === "chatgpt" ? "chatgpt" as const : null;
    return { connected: Boolean(account), authMode, planType: account?.planType || null };
}

/** 将 Codex turn 加入串行队列并等待执行完成。 */
export async function runCodexTurn(prompt: string, emit: AgentEmit, attachments: AgentAttachment[] = [], options: CodexRunOptions = {}) {
    if (!prompt.trim()) return;
    codexQueue = codexQueue.catch(() => undefined).then(() => runCodexTurnNow(prompt, emit, attachments, options));
    await codexQueue;
}

/** 中断当前线程正在执行的 Codex turn。 */
export async function interruptCodexTurn(threadId?: string, runtime: AgentCodexRuntime = "subscription") {
    const state = runtimeState(runtime);
    if (!state.app || (threadId && threadId !== state.threadId)) return false;
    return await state.app.interruptCurrentTurn();
}

/** 回复当前 app-server 的待处理权限请求。 */
export async function resolveCodexApproval(requestId: string, decision: string, runtime: AgentCodexRuntime = "subscription") {
    return Boolean(runtimeState(runtime).app?.resolveApproval(requestId, decision));
}

/** 读取指定 Codex 运行环境的脱敏账户状态。 */
export async function readCodexAccount(emit: AgentEmit, runtime: AgentCodexRuntime = "subscription") {
    const result = await (await getCodexApp(emit, runtime)).readAccount();
    return { ...classifyCodexAccount(result.account), runtime };
}

/** 配置 Agent 专用 KapeAI 运行环境，密钥不会被返回或写入站点配置。 */
export async function configureKapeaiApiKey(emit: AgentEmit, apiKey: string) {
    const app = await getCodexApp(emit, "kapeai");
    await app.loginWithApiKey(apiKey);
    return readCodexAccount(emit, "kapeai");
}

/** 清除 Agent 专用 Codex 家目录内的登录凭据。 */
export async function clearKapeaiApiKey(emit: AgentEmit) {
    await (await getCodexApp(emit, "kapeai")).logout();
}

/** 创建新的 Codex 线程并记录当前线程 ID。 */
export async function startCodexThread(emit: AgentEmit, cwd?: string, permissionMode: AgentPermissionMode = "request", runtime: AgentCodexRuntime = "subscription") {
    const state = runtimeState(runtime);
    const app = await getCodexApp(emit, runtime);
    const thread = await app.startThread(cwd, permissionMode);
    state.threadId = String(field(thread, "id") || "");
    if (state.threadId) state.unmaterializedThreadIds.add(state.threadId);
    return thread;
}

/** 恢复指定 Codex 线程并返回聊天历史。 */
export async function resumeCodexThread(emit: AgentEmit, threadId: string, cwd?: string, permissionMode: AgentPermissionMode = "request", runtime: AgentCodexRuntime = "subscription") {
    const state = runtimeState(runtime);
    const app = await getCodexApp(emit, runtime);
    await loadCodexThread(emit, threadId, cwd, false, runtime);
    const thread = await app.resumeThread(threadId, cwd, permissionMode);
    assertThreadWorkspace(thread, cwd);
    state.threadId = String(field(thread, "id") || threadId);
    const historyThread = await loadCodexThread(emit, state.threadId, cwd, true, runtime);
    return { thread, messages: threadMessages(historyThread, app.planUpdates(threadId)) };
}

/** 查询当前工作空间中的 Codex 线程。 */
export async function listCodexThreads(emit: AgentEmit, options: { cwd: string; searchTerm?: string; limit?: number; runtime?: AgentCodexRuntime }) {
    const app = await getCodexApp(emit, options.runtime || "subscription");
    const result = await app.listThreads({
        limit: options.limit || 40,
        sortKey: "updated_at",
        sortDirection: "desc",
        sourceKinds: ["cli", "vscode", "appServer", "exec"],
        cwd: options.cwd,
        ...(options.searchTerm ? { searchTerm: options.searchTerm } : {}),
    });
    const data = Array.isArray(field(result, "data")) ? (field(result, "data") as unknown[]).map(summarizeCodexThread).filter((thread) => threadInWorkspace(thread, options.cwd)) : [];
    return { data, nextCursor: field(result, "nextCursor") || null, backwardsCursor: field(result, "backwardsCursor") || null };
}

/** 读取指定 Codex 线程及其聊天历史。 */
export async function readCodexThread(emit: AgentEmit, threadId: string, cwd?: string, runtime: AgentCodexRuntime = "subscription") {
    const app = await getCodexApp(emit, runtime);
    const state = runtimeState(runtime);
    let thread: unknown;
    try {
        thread = await loadCodexThread(emit, threadId, cwd, !state.unmaterializedThreadIds.has(threadId), runtime);
    } catch (error) {
        if (!/not materialized yet.*includeTurns/i.test(errorMessage(error))) throw error;
        state.unmaterializedThreadIds.add(threadId);
        thread = await loadCodexThread(emit, threadId, cwd, false, runtime);
    }
    return { thread: summarizeCodexThread(thread), messages: threadMessages(thread, app.planUpdates(threadId)) };
}

/** 确认指定 Codex 线程属于当前工作空间。 */
export async function verifyCodexThreadWorkspace(emit: AgentEmit, threadId: string, cwd: string, runtime: AgentCodexRuntime = "subscription") {
    await loadCodexThread(emit, threadId, cwd, false, runtime);
}

/** 归档指定 Codex 线程。 */
export async function archiveCodexThread(emit: AgentEmit, threadId: string, cwd?: string, runtime: AgentCodexRuntime = "subscription") {
    const app = await getCodexApp(emit, runtime);
    const state = runtimeState(runtime);
    await loadCodexThread(emit, threadId, cwd, false, runtime);
    await app.archiveThread(threadId);
    app.clearPlanUpdates(threadId);
    state.unmaterializedThreadIds.delete(threadId);
}

/** 判断线程异常是否允许自动新建线程后重试。 */
export function isRecoverableThreadError(error: unknown) {
    return /thread not loaded|no rollout found/i.test(errorMessage(error));
}

/** 执行一次 Codex turn，并负责附件临时文件和线程恢复。 */
async function runCodexTurnNow(prompt: string, emit: AgentEmit, attachments: AgentAttachment[], options: CodexRunOptions) {
    let files: string[] = [];
    try {
        options.onStart?.();
        files = await writeAttachmentFiles(attachments);
        const runtime = options.runtime || "subscription";
        const state = runtimeState(runtime);
        const app = await getCodexApp(options.appEmit || emit, runtime);
        let threadId = await ensureCodexThread(app, options, emit, runtime);
        options.onThread?.(threadId);
        state.unmaterializedThreadIds.delete(threadId);
        try {
            await app.startTurn(threadId, prompt, files, options.permissionMode || "request", options.onTurn);
        } catch (error) {
            if (!isRecoverableThreadError(error)) throw error;
            emit("agent_log", { text: `Codex thread unavailable, starting a new thread: ${errorMessage(error)}` });
            state.threadId = "";
            threadId = await ensureCodexThread(app, { cwd: options.cwd, runtime }, emit, runtime);
            options.onThread?.(threadId);
            state.unmaterializedThreadIds.delete(threadId);
            await app.startTurn(threadId, prompt, files, options.permissionMode || "request", options.onTurn);
        }
    } catch (error) {
        logger.error("Codex turn failed", error);
        emit("agent_error", { message: errorMessage(error) });
    } finally {
        options.onFinish?.();
        await Promise.all(files.map((file) => fs.unlink(file).catch(() => undefined)));
    }
}

/** 恢复请求线程或创建新的 Codex 线程。 */
async function ensureCodexThread(app: CodexAppClient, options: CodexRunOptions, emit: AgentEmit, runtime: AgentCodexRuntime) {
    const state = runtimeState(runtime);
    if (options.threadId) {
        if (options.threadId === state.threadId) return state.threadId;
        try {
            const result = await app.readThread(options.threadId, false);
            assertThreadWorkspace(field(result, "thread") || {}, options.cwd);
            const thread = await app.resumeThread(options.threadId, options.cwd, options.permissionMode || "request");
            assertThreadWorkspace(thread, options.cwd);
            state.threadId = String(field(thread, "id") || options.threadId);
            return state.threadId;
        } catch (error) {
            if (!isRecoverableThreadError(error)) throw error;
            emit("agent_log", { text: `Codex thread unavailable, starting a new thread: ${errorMessage(error)}` });
        }
    }
    if (!state.threadId) {
        const thread = await app.startThread(options.cwd, options.permissionMode || "request");
        state.threadId = String(field(thread, "id") || "");
        if (state.threadId) state.unmaterializedThreadIds.add(state.threadId);
    }
    return state.threadId;
}

/** 从 app-server 读取线程并校验工作空间。 */
async function loadCodexThread(emit: AgentEmit, threadId: string, cwd: string | undefined, includeTurns: boolean, runtime: AgentCodexRuntime) {
    const app = await getCodexApp(emit, runtime);
    const result = await app.readThread(threadId, includeTurns);
    const thread = field(result, "thread") || {};
    assertThreadWorkspace(thread, cwd);
    return thread;
}

/** 获取已启动的 Codex app-server 客户端。 */
async function getCodexApp(emit: AgentEmit, runtime: AgentCodexRuntime) {
    const state = runtimeState(runtime);
    if (state.app) return state.app;
    state.appStart ||= CodexAppClient.start(emit, () => {
        state.app = null;
        state.threadId = "";
    });
    try {
        state.app = await state.appStart;
        return state.app;
    } finally {
        state.appStart = null;
    }
}

/** 校验线程是否属于指定工作空间。 */
function assertThreadWorkspace(thread: unknown, cwd?: string) {
    if (!cwd || threadInWorkspace(thread, cwd)) return;
    throw new Error("该 Codex 会话不属于当前画布工作空间");
}

/** 判断线程工作目录是否与当前工作空间一致。 */
function threadInWorkspace(thread: unknown, cwd: string) {
    const threadCwd = String(field(thread, "cwd") || "");
    return Boolean(threadCwd && path.resolve(threadCwd) === path.resolve(cwd));
}

/** 将图片附件写入临时文件供 Codex 读取。 */
async function writeAttachmentFiles(attachments: AgentAttachment[]) {
    return await Promise.all(attachments.filter((item) => item.dataUrl?.startsWith("data:image/")).map(writeAttachmentFile));
}

/** 将单个 Data URL 图片附件写入临时文件。 */
async function writeAttachmentFile(item: AgentAttachment) {
    const [, meta = "", data = ""] = item.dataUrl?.match(/^data:([^;]+);base64,(.+)$/) || [];
    if (!data) throw new Error(`图片附件无效：${item.name || "未命名图片"}`);
    const file = path.join(os.tmpdir(), `sneeai-agent-${Date.now()}-${Math.random().toString(16).slice(2)}.${imageExt(meta || item.type)}`);
    await fs.writeFile(file, Buffer.from(data, "base64"));
    return file;
}

/** 根据图片 MIME 类型返回临时文件扩展名。 */
function imageExt(type = "") {
    if (type.includes("png")) return "png";
    if (type.includes("webp")) return "webp";
    return "jpg";
}
