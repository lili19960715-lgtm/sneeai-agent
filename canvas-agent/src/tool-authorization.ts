import crypto from "node:crypto";

import { canResolveEntitlementAuthority, resolveEntitlementPublicKey, type PublicKeyMaterial } from "./entitlement.js";

const MAX_TOKEN_LENGTH = 8192;
const MAX_ACTION_LIFETIME_SECONDS = 10;

export type ToolAuthorizationClaims = {
    version: 1;
    iss: string;
    aud: "sneeai-agent-action";
    scope: "agent:tool:execute";
    sub: string;
    origin: string;
    profile_id: string;
    client_id: string;
    device_id: string;
    authorization_version: number;
    operation_id: string;
    operation_class: "agent_write";
    commitment: string;
    iat: number;
    exp: number;
    jti: string;
};

export type ToolAuthorizationBinding = {
    origin: string;
    profileId: string;
    clientId: string;
    deviceId: string;
    subject: string;
    authorizationVersion: number;
    operationId: string;
    commitment: string;
};

export class ToolAuthorizationVerificationError extends Error {
    constructor(readonly code: string, message: string, readonly statusCode = 403) {
        super(message);
        this.name = "ToolAuthorizationVerificationError";
    }
}

/** 进程内消费已验证的 action JWT JTI；记录只保留到 permit 过期。 */
export class ToolAuthorizationReplayGuard {
    private used = new Map<string, number>();

    consume(jti: string, expiresAt: number, now = Date.now()) {
        this.prune(now);
        if (this.used.has(jti)) return false;
        this.used.set(jti, expiresAt);
        return true;
    }

    clear() {
        this.used.clear();
    }

    private prune(now: number) {
        this.used.forEach((expiresAt, jti) => {
            if (expiresAt <= now) this.used.delete(jti);
        });
    }
}

/** 校验只允许执行一个已绑定 pending operation 的短期网站许可。 */
export async function verifyToolAuthorization(
    token: string,
    expected: ToolAuthorizationBinding,
    options: { now?: number; resolvePublicKey?: (origin: string, keyId: string) => Promise<PublicKeyMaterial> } = {},
) {
    if (!canResolveEntitlementAuthority(expected.origin)) {
        throw new ToolAuthorizationVerificationError("tool_authorization_origin_not_allowed", "Tool authorization authority origin is not allowed");
    }
    const parts = typeof token === "string" ? token.split(".") : [];
    if (!token || token.length > MAX_TOKEN_LENGTH || parts.length !== 3) {
        throw invalidAuthorization();
    }
    const header = parseObject(parts[0]);
    const claims = parseObject(parts[1]);
    if (header.alg !== "EdDSA" || header.typ !== "agent-action+jwt" || typeof header.kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)) {
        throw invalidAuthorization("Tool authorization header is invalid");
    }

    const resolve = options.resolvePublicKey || resolveEntitlementPublicKey;
    let publicKey: PublicKeyMaterial;
    try {
        publicKey = await resolve(expected.origin, header.kid);
    } catch {
        throw new ToolAuthorizationVerificationError("tool_authorization_authority_unavailable", "Unable to verify tool authorization", 503);
    }
    if (publicKey.keyId !== header.kid || publicKey.algorithm !== "EdDSA") {
        throw new ToolAuthorizationVerificationError("tool_authorization_key_mismatch", "Tool authorization key is invalid");
    }

    const signature = decodeBase64Url(parts[2]);
    if (!signature || signature.length !== 64) throw invalidAuthorization("Tool authorization signature is invalid");
    let verified = false;
    try {
        verified = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey.keyObject, signature);
    } catch {
        verified = false;
    }
    if (!verified) throw invalidAuthorization("Tool authorization signature is invalid");

    const parsedClaims = validateClaims(claims, expected, options.now ?? Date.now());
    if (parsedClaims.iss !== publicKey.issuer) {
        throw new ToolAuthorizationVerificationError("tool_authorization_key_mismatch", "Tool authorization key is invalid");
    }
    return parsedClaims;
}

function validateClaims(value: Record<string, unknown>, expected: ToolAuthorizationBinding, nowMs: number): ToolAuthorizationClaims {
    const requiredStrings = ["iss", "sub", "origin", "profile_id", "client_id", "device_id", "operation_id", "commitment", "jti"];
    if (value.version !== 1
        || value.aud !== "sneeai-agent-action"
        || value.scope !== "agent:tool:execute"
        || value.operation_class !== "agent_write"
        || requiredStrings.some((key) => typeof value[key] !== "string")) {
        throw invalidAuthorization("Tool authorization claims are invalid");
    }
    const claims = value as unknown as ToolAuthorizationClaims;
    if (!isExactOrigin(claims.iss)
        || !isExactOrigin(claims.origin)
        || claims.origin !== expected.origin
        || claims.sub !== expected.subject
        || claims.profile_id !== expected.profileId
        || claims.profile_id !== `v1:user:${claims.sub}`
        || claims.client_id !== expected.clientId
        || claims.device_id !== expected.deviceId
        || claims.authorization_version !== expected.authorizationVersion
        || claims.operation_id !== expected.operationId
        || claims.commitment !== expected.commitment
        || !claims.jti) {
        throw new ToolAuthorizationVerificationError("tool_authorization_binding_mismatch", "Tool authorization does not match this operation");
    }
    if (!Number.isSafeInteger(claims.authorization_version)
        || claims.authorization_version <= 0
        || !Number.isSafeInteger(claims.iat)
        || !Number.isSafeInteger(claims.exp)
        || claims.exp <= claims.iat
        || claims.exp - claims.iat > MAX_ACTION_LIFETIME_SECONDS) {
        throw invalidAuthorization("Tool authorization time claims are invalid");
    }
    const now = Math.floor(nowMs / 1000);
    if (claims.exp <= now || claims.iat > now + MAX_ACTION_LIFETIME_SECONDS) {
        throw new ToolAuthorizationVerificationError("tool_authorization_expired", "Tool authorization has expired");
    }
    return claims;
}

function parseObject(segment: string): Record<string, unknown> {
    const decoded = decodeBase64Url(segment);
    if (!decoded) throw invalidAuthorization();
    try {
        const value = JSON.parse(decoded.toString("utf8")) as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
        return value as Record<string, unknown>;
    } catch {
        throw invalidAuthorization();
    }
}

function decodeBase64Url(value: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
    try {
        return Buffer.from(value, "base64url");
    } catch {
        return null;
    }
}

function isExactOrigin(value: string) {
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash && url.origin === value;
    } catch {
        return false;
    }
}

function invalidAuthorization(message = "Tool authorization is invalid") {
    return new ToolAuthorizationVerificationError("tool_authorization_invalid", message);
}
