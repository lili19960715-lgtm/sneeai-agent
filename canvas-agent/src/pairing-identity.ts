import crypto from "node:crypto";

import { canResolveEntitlementAuthority, EntitlementVerificationError, resolveEntitlementPublicKey, type PublicKeyMaterial } from "./entitlement.js";

const PAIRING_CHALLENGE_TYPE = "agent-pairing-challenge+jwt";
const PAIRING_CHALLENGE_AUDIENCE = "sneeai-agent-pairing";
const PAIRING_CHALLENGE_SCOPE = "agent:pairing:prove";
const PAIRING_PROOF_CONTEXT = "sneeai-agent-pairing-proof-v1\0";
const PAIRING_CONFIRMATION_CONTEXT = "sneeai-agent-pairing-confirmation-v1\0";
const INSTANCE_KEY_DERIVATION_CONTEXT = "sneeai-agent-instance-key-v1";
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const MAX_CHALLENGE_LENGTH = 8192;

export type PairingChallengeBinding = {
    origin: string;
    profileId: string;
    clientId: string;
    deviceId: string;
    agentVersion: string;
};

export type AgentPairingIdentity = {
    instanceKey: string;
    instancePublicKey: string;
    prove: (
        challenge: string,
        expected: PairingChallengeBinding,
        options?: { now?: number; resolvePublicKey?: (origin: string, keyId: string) => Promise<PublicKeyMaterial> },
    ) => Promise<string>;
    confirm: (nonce: string, entitlement: string, pairingTicket: string) => string;
};

type PairingChallengeClaims = {
    version: 1;
    iss: string;
    aud: typeof PAIRING_CHALLENGE_AUDIENCE;
    sub: string;
    scope: typeof PAIRING_CHALLENGE_SCOPE;
    origin: string;
    profile_id: string;
    client_id: string;
    device_id: string;
    agent_version: string;
    instance_key: string;
    iat: number;
    exp: number;
    jti: string;
};

/** 从本机受保护 token 派生稳定实例身份；私钥只存在于当前进程内存。 */
export function createAgentPairingIdentity(secret: string): AgentPairingIdentity {
    if (typeof secret !== "string" || secret.length < 24) throw new Error("Sneeai Agent identity secret is invalid");
    const seed = crypto.createHmac("sha256", secret).update(INSTANCE_KEY_DERIVATION_CONTEXT).digest();
    const privateKey = crypto.createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
    const publicDer = crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" }) as Buffer;
    const rawPublicKey = publicDer.subarray(publicDer.length - 32);
    const instancePublicKey = rawPublicKey.toString("base64url");
    const instanceKey = `i1:${crypto.createHash("sha256").update(rawPublicKey).digest("base64url")}`;
    return {
        instanceKey,
        instancePublicKey,
        prove: async (challenge, expected, options = {}) => {
            await verifyPairingChallenge(challenge, { ...expected, instanceKey }, options);
            return crypto.sign(null, Buffer.from(PAIRING_PROOF_CONTEXT + challenge), privateKey).toString("base64url");
        },
        confirm: (nonce, entitlement, pairingTicket) => {
            if (!/^[A-Za-z0-9_-]{43}$/.test(nonce) || entitlement.length > 8192 || !pairingTicket || pairingTicket.length > 4096) {
                throw new Error("Agent pairing confirmation input is invalid");
            }
            return crypto.sign(null, pairingConfirmationMessage(nonce, entitlement, pairingTicket), privateKey).toString("base64url");
        },
    };
}

export function pairingConfirmationMessage(nonce: string, entitlement: string, pairingTicket: string) {
    return Buffer.from(`${PAIRING_CONFIRMATION_CONTEXT}${nonce}\0${entitlement}\0${pairingTicket}`);
}

async function verifyPairingChallenge(
    challenge: string,
    expected: PairingChallengeBinding & { instanceKey: string },
    options: { now?: number; resolvePublicKey?: (origin: string, keyId: string) => Promise<PublicKeyMaterial> },
) {
    if (!canResolveEntitlementAuthority(expected.origin)) {
        throw new EntitlementVerificationError("agent_pairing_origin_not_allowed", "pairing authority origin is not allowed");
    }
    if (typeof challenge !== "string" || challenge.length === 0 || challenge.length > MAX_CHALLENGE_LENGTH) {
        throw pairingChallengeError();
    }
    const parts = challenge.split(".");
    if (parts.length !== 3) throw pairingChallengeError();
    const header = parseSegment(parts[0]);
    if (header.alg !== "EdDSA" || header.typ !== PAIRING_CHALLENGE_TYPE || typeof header.kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)) {
        throw pairingChallengeError();
    }
    const resolve = options.resolvePublicKey || resolveEntitlementPublicKey;
    let material: PublicKeyMaterial;
    try {
        material = await resolve(expected.origin, header.kid);
    } catch {
        throw new EntitlementVerificationError("agent_pairing_authority_unavailable", "无法验证网站配对请求，请检查网站连接", 503);
    }
    if (material.keyId !== header.kid || material.algorithm !== "EdDSA") throw pairingChallengeError();
    const signature = decodeBase64Url(parts[2]);
    if (!signature || signature.length !== 64 || !crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), material.keyObject, signature)) {
        throw pairingChallengeError();
    }
    const claims = parseSegment(parts[1]) as Partial<PairingChallengeClaims>;
    const now = Math.floor((options.now ?? Date.now()) / 1000);
    if (claims.version !== 1 || claims.aud !== PAIRING_CHALLENGE_AUDIENCE || claims.scope !== PAIRING_CHALLENGE_SCOPE
        || claims.iss !== material.issuer || claims.origin !== expected.origin || claims.profile_id !== expected.profileId
        || claims.client_id !== expected.clientId || claims.device_id !== expected.deviceId || claims.agent_version !== expected.agentVersion
        || claims.instance_key !== expected.instanceKey || claims.profile_id !== `v1:user:${claims.sub}`
        || typeof claims.sub !== "string" || !claims.sub || typeof claims.jti !== "string" || !claims.jti
        || !isExactOrigin(claims.iss) || !isExactOrigin(claims.origin)
        || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
        || Number(claims.exp) <= now || Number(claims.iat) > now + 30 || Number(claims.exp) <= Number(claims.iat)
        || Number(claims.exp) - Number(claims.iat) > 60 || Number(claims.iat) < now - 60) {
        throw pairingChallengeError();
    }
}

function pairingChallengeError() {
    return new EntitlementVerificationError("agent_pairing_challenge_invalid", "Agent pairing challenge is invalid");
}

function parseSegment(value: string): Record<string, unknown> {
    const decoded = decodeBase64Url(value);
    if (!decoded) throw pairingChallengeError();
    try {
        const parsed = JSON.parse(decoded.toString("utf8")) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid object");
        return parsed as Record<string, unknown>;
    } catch {
        throw pairingChallengeError();
    }
}

function decodeBase64Url(value: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
    try {
        const decoded = Buffer.from(value, "base64url");
        return decoded.toString("base64url") === value ? decoded : null;
    } catch {
        return null;
    }
}

function isExactOrigin(value: unknown): value is string {
    if (typeof value !== "string") return false;
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash && url.origin === value;
    } catch {
        return false;
    }
}
