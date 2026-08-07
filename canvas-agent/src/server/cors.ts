/** 仅允许已配置来源；空配置时由首个通过 token 鉴权的来源完成绑定。 */
export function authorizeRequestOrigin(origins: string[], origin: string, authenticated: boolean) {
    if (origins.includes(origin)) return true;
    if (!authenticated || origins.length) return false;
    origins.push(origin);
    return true;
}

const OFFICIAL_CANVAS_ORIGINS = new Set(["https://sneeai.com"]);
const LOCAL_DEVELOPMENT_ORIGINS = new Set([
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3001",
    "http://localhost:3001",
    "http://127.0.0.1:3100",
    "http://localhost:3100",
]);

export function isOfficialCanvasOrigin(origin: string) {
    return OFFICIAL_CANVAS_ORIGINS.has(origin);
}

/** 仅允许官方站点或显式配置的开发站点自动取得本机配对凭据。 */
export function authorizeAutomaticPairing(
    origin: string,
    configuredOrigins = process.env.CANVAS_AGENT_PAIR_ORIGINS || "",
    registeredOrigins: readonly string[] = [],
) {
    const normalizedOrigin = exactOrigin(origin);
    if (!normalizedOrigin) return false;
    if (configuredOrigins.split(",").some((value) => exactOrigin(value.trim()) === normalizedOrigin)) return true;
    if (OFFICIAL_CANVAS_ORIGINS.has(normalizedOrigin)) return true;
    if (LOCAL_DEVELOPMENT_ORIGINS.has(normalizedOrigin)) return true;
    return isLoopbackDevelopmentOrigin(normalizedOrigin)
        && registeredOrigins.some((value) => exactOrigin(value) === normalizedOrigin);
}

function isLoopbackDevelopmentOrigin(origin: string) {
    const url = new URL(origin);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
}

function exactOrigin(value: string) {
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "";
        if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
        return url.origin === value ? url.origin : "";
    } catch {
        return "";
    }
}
