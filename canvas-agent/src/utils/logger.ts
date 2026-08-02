import fs from "node:fs";
import path from "node:path";
import {inspect} from "node:util";

import winston, {format, transports, type Logger as WinstonLogger} from "winston";

import {CONFIG_DIR} from "../config.js";
import {formatDateForFilename} from "./date.js";

/** 管理 Sneeai Agent 的终端与文件 Debug 日志。 */
export class Logger {
    readonly enabled = process.argv.includes("--debug");
    readonly filePath = this.enabled ? path.join(CONFIG_DIR, "logs", `canvas-agent-${formatDateForFilename()}.log`) : "";
    private readonly logger: WinstonLogger | null;

    /** 根据命令行 Debug 参数初始化日志输出。 */
    constructor() {
        if (!this.enabled) {
            this.logger = null;
            return;
        }
        fs.mkdirSync(path.dirname(this.filePath), {recursive: true});
        const line = format.printf(({level, message, timestamp, details}) => `${timestamp} ${level.toUpperCase()} ${message}${formatDetails(details)}`);
        const mcpMode = process.argv.slice(2).filter((arg) => arg !== "--debug")[0] === "mcp";
        this.logger = winston.createLogger({
            level: "debug",
            transports: [
                new transports.Console({
                    format: format.combine(format.timestamp({format: "HH:mm:ss"}), line),
                    ...(mcpMode ? {stderrLevels: ["debug", "info", "warn", "error"]} : {}),
                }),
                new transports.File({filename: this.filePath, options: {mode: 0o600}, format: format.combine(format.timestamp({format: "HH:mm:ss"}), line)}),
            ],
        });
    }

    /** 输出 Debug 级别日志。 */
    debug(message: string, details?: unknown) {
        if (details === undefined) this.logger?.debug(message);
        else this.logger?.debug(message, {details: sanitize(details)});
    }

    /** 输出 Info 级别日志。 */
    info(message: string, details?: unknown) {
        if (details === undefined) this.logger?.info(message);
        else this.logger?.info(message, {details: sanitize(details)});
    }

    /** 输出 Warn 级别日志。 */
    warn(message: string, details?: unknown) {
        if (details === undefined) this.logger?.warn(message);
        else this.logger?.warn(message, {details: sanitize(details)});
    }

    /** 输出 Error 级别日志。 */
    error(message: string, details?: unknown) {
        if (details === undefined) this.logger?.error(message);
        else this.logger?.error(message, {details: sanitize(details)});
    }
}

/** 将日志详情格式化为紧凑的单行文本。 */
function formatDetails(details: unknown) {
    if (details === undefined) return "";
    if (!details || typeof details !== "object" || Array.isArray(details)) return ` ${inspect(details, {depth: null, breakLength: Infinity})}`;
    const text = Object.entries(details).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${inspect(value, {depth: null, breakLength: Infinity})}`).join(" ");
    return text ? ` ${text}` : "";
}

/** 清理日志内容中的敏感数据和不可序列化引用。 */
function sanitize(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
    if (/token|authorization|api.?key|dataurl/i.test(key)) return "[REDACTED]";
    if (typeof value === "string") {
        if (value.startsWith("data:")) return `[DATA URL ${value.length} chars]`;
        return redactSensitiveText(value);
    }
    if (value instanceof Error) return {name: value.name, message: redactSensitiveText(value.message), stack: value.stack ? redactSensitiveText(value.stack) : undefined};
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => sanitize(item, key, seen));
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([field, item]) => [field, sanitize(item, field, seen)]));
}

export const logger = new Logger();

/** Redact credential-shaped values before diagnostics can leave the local process. */
export function redactSensitiveText(value: string) {
    return value
        .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
        .replace(/([?&](?:api[_-]?key|token|secret|password|authorization)=)[^&#\s]+/gi, "$1[REDACTED]")
        .replace(/(\b(?:api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*)(["']?)[^\s,;"'}]+/gi, "$1$2[REDACTED]")
        .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
}
