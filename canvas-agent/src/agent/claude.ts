import { spawn } from "node:child_process";

import { AGENT_PROMPT } from "../config.js";
import { redactSensitiveText } from "../utils/logger.js";
import { errorMessage } from "../utils/value.js";
import type { AgentEmit } from "./types.js";

const CLAUDE_ARGS = Object.freeze(["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--allowedTools", "mcp__sneeai-agent__*"]);

export type ClaudeInvocation = { command: "claude"; args: string[]; stdin: string; shell: boolean };

/** 使用 Claude CLI 执行一次带 Sneeai Agent 工具的任务。 */
export function runClaudeTurn(prompt: string, emit: AgentEmit) {
    const invocation = claudeInvocation(prompt);
    if (!invocation.stdin) return;
    const child = spawnAgent(invocation, emit);
    if (child) {
        pipeJsonLines(child, emit, "claude");
        child.stdin?.on("error", () => emit("agent_error", { message: "Claude Agent 输入通道异常" }));
        child.stdin?.end(invocation.stdin);
    }
}

/** Build a fixed command line; the complete prompt is carried only over stdin.
 *  所有平台都 shell:false + 静态 argv，避免任何命令行拼接或 shell 解释（含 win32）。 */
export function claudeInvocation(prompt: string, _platform: NodeJS.Platform = process.platform): ClaudeInvocation {
    return { command: "claude", args: [...CLAUDE_ARGS], stdin: withAgentPrompt(prompt), shell: false };
}

/** 为 Claude CLI 请求拼接 Sneeai Agent 指令。 */
function withAgentPrompt(prompt: string) {
    return prompt.trim() ? `${AGENT_PROMPT}\n\n用户请求：${prompt}` : "";
}

/** 将 Claude CLI 的 JSON Lines 输出转换为 Agent 事件。 */
function pipeJsonLines(child: ReturnType<typeof spawn>, emit: AgentEmit, agent: string) {
    let out = "";
    child.stdout?.on("data", (chunk) => {
        out += chunk.toString();
        const lines = out.split(/\r?\n/);
        out = lines.pop() || "";
        lines.filter(Boolean).forEach((line) => {
            try {
                emit("agent_event", { agent, ...JSON.parse(line) });
            } catch {
                emit("agent_event", { agent, type: "raw", text: line });
            }
        });
    });
    child.stderr?.on("data", (chunk) => emit("agent_log", { text: redactSensitiveText(chunk.toString()) }));
    child.on("error", () => emit("agent_error", { message: "Claude Agent 进程异常" }));
    child.on("close", (code) => emit("agent_done", { agent, code }));
}

/** 启动外部 Agent CLI，并将同步启动异常转换为事件。 */
function spawnAgent(invocation: ClaudeInvocation, emit: AgentEmit) {
    try {
        return spawn(invocation.command, invocation.args, { stdio: ["pipe", "pipe", "pipe"], shell: invocation.shell, windowsHide: true });
    } catch (error) {
        emit("agent_error", { message: redactSensitiveText(errorMessage(error)) });
        return null;
    }
}
