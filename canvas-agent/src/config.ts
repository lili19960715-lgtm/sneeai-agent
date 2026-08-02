import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 17371;
export const CONFIG_DIR = path.join(os.homedir(), ".sneeai-agent");
export const CONFIG_FILE = path.join(CONFIG_DIR, "sneeai-agent.json");
export const CODEX_KAPEAI_HOME = path.join(CONFIG_DIR, "codex-kapeai");
export const VERSION = readPackageVersion();
export const AGENT_PROMPT = fs.readFileSync(new URL("../agent-instructions.md", import.meta.url), "utf8");
const initializedWorkspaces = new Set<string>();

export type SiteWorkspaceConfig = { workspacePath: string; activeThreadId?: string; pinnedThreadIds?: string[] };
export type AgentCodexRuntime = "subscription" | "kapeai";
export type CanvasAgentConfig = { url: string; token: string; origins?: string[]; workspace?: SiteWorkspaceConfig; codexRuntime?: AgentCodexRuntime };

/** 读取本地 Canvas Agent 配置，不存在时生成默认配置。 */
export function loadConfig(create = false): CanvasAgentConfig {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as CanvasAgentConfig;
    } catch {
        const config = { url: `http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}`, token: crypto.randomBytes(18).toString("hex") };
        if (create) saveConfig(config);
        return config;
    }
}

/** 将 Canvas Agent 配置写入用户配置目录。 */
export function saveConfig(config: CanvasAgentConfig) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
    try { fs.chmodSync(CONFIG_FILE, 0o600); } catch {}
}

/** 返回 Agent 专用 Codex 家目录。该目录与用户默认 ~/.codex 完全隔离。 */
export function kapeaiCodexHome() {
    fs.mkdirSync(CODEX_KAPEAI_HOME, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(CODEX_KAPEAI_HOME, 0o700); } catch {}
    return CODEX_KAPEAI_HOME;
}

/** 写入 KapeAI provider 配置；API key 由 Codex app-server 自己持久化，不写入本配置文件。 */
export function ensureKapeaiCodexConfig() {
    const home = kapeaiCodexHome();
    const file = path.join(home, "config.toml");
    const content = [
        'model_provider = "kapeai"',
        '',
        '[model_providers.kapeai]',
        'name = "KapeAI"',
        'base_url = "https://api.kapeai.cn/v1"',
        'wire_api = "responses"',
        'env_key = "KAPEAI_API_KEY"',
        '',
    ].join("\n");
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) fs.writeFileSync(file, content, { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch {}
    return home;
}

/** 确保站点级 Codex 工作空间存在并已初始化。 */
export function ensureSiteWorkspace(config: CanvasAgentConfig) {
    const current = config.workspace;
    if (current?.workspacePath) {
        const workspacePath = resolveWorkspacePath(current.workspacePath);
        initializeWorkspace(workspacePath);
        return { ...current, workspacePath };
    }
    const workspacePath = path.join(CONFIG_DIR, "codex-workspaces", "site");
    config.workspace = { workspacePath };
    initializeWorkspace(workspacePath);
    saveConfig(config);
    return { workspacePath };
}

/** 更新站点级 Codex 工作空间配置。 */
export function updateSiteWorkspace(config: CanvasAgentConfig, patch: Partial<SiteWorkspaceConfig>) {
    const current = ensureSiteWorkspace(config);
    const workspacePath = patch.workspacePath ? resolveWorkspacePath(patch.workspacePath) : current.workspacePath;
    const next = { ...current, ...patch, workspacePath };
    config.workspace = { workspacePath: next.workspacePath, activeThreadId: next.activeThreadId, pinnedThreadIds: next.pinnedThreadIds };
    initializeWorkspace(workspacePath);
    saveConfig(config);
    return config.workspace;
}

/** 创建工作空间目录并写入默认 AGENTS.md。 */
function initializeWorkspace(workspacePath: string) {
    if (initializedWorkspaces.has(workspacePath)) return;
    fs.mkdirSync(workspacePath, { recursive: true });
    const instructionsFile = path.join(workspacePath, "AGENTS.md");
    const current = fs.existsSync(instructionsFile) ? fs.readFileSync(instructionsFile, "utf8") : "";
    if (!current || current.startsWith("# Infinite Canvas Agent") || current.startsWith("# Sneeai Agent")) fs.writeFileSync(instructionsFile, AGENT_PROMPT);
    initializedWorkspaces.add(workspacePath);
}

/** 将用户输入的工作空间路径解析为绝对路径。 */
function resolveWorkspacePath(value: string) {
    if (value === "~") return os.homedir();
    if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
    return path.resolve(value);
}

/** 从当前包信息中读取 Canvas Agent 版本号。 */
function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}
