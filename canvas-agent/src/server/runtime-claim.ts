const RUNTIME_CLAIM_PATTERN = /^v1:[a-f0-9]{24}:[a-f0-9]{8}$/;

/** 为当前 MCP 进程生成可跨进程排序的本机桥接所有权标识。 */
export function createRuntimeClaim(clock = process.hrtime.bigint(), pid = process.pid) {
    return `v1:${clock.toString(16).padStart(24, "0")}:${Math.max(0, pid).toString(16).padStart(8, "0")}`;
}

/** 校验桥接所有权标识，避免任意字符串参与排序。 */
export function isRuntimeClaim(value: unknown): value is string {
    return typeof value === "string" && RUNTIME_CLAIM_PATTERN.test(value);
}

/** 比较两个已校验的所有权标识；后启动的进程排序更大。 */
export function compareRuntimeClaims(left: string, right: string) {
    return left === right ? 0 : left > right ? 1 : -1;
}
