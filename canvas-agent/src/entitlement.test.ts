import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { canResolveEntitlementAuthority, canUsePersistentToken, entitlementRequired, EntitlementVerificationError, verifyPlatformEntitlement, type PublicKeyMaterial } from "./entitlement.js";
import { createAgentPairingIdentity, pairingConfirmationMessage } from "./pairing-identity.js";

const origin = "https://sneeai.com";
const profileId = "v1:user:user-1";
const clientId = "client-1";
const deviceId = `d1:${"a".repeat(43)}`;
const instanceKey = `i1:${"b".repeat(43)}`;
const agentVersion = "0.3.2";
const now = 1_800_000_000_000;
const expectedBinding = { origin, profileId, clientId, deviceId, instanceKey, agentVersion };

test("a platform entitlement verifies with the pinned Ed25519 key", async () => {
    const fixture = signedToken();
    const claims = await verifyPlatformEntitlement(fixture.token, expectedBinding, {
        now,
        resolvePublicKey: async () => fixture.material,
    });

    assert.equal(claims.sub, "user-1");
    assert.equal(claims.origin, origin);
    assert.equal(claims.profile_id, profileId);
    assert.equal(claims.client_id, clientId);
    assert.equal(claims.device_id, deviceId);
    assert.equal(claims.authorization_version, 7);
});

test("forged signatures and unknown key ids are rejected", async () => {
    const fixture = signedToken();
    const [header, payload, signature] = fixture.token.split(".");
    const forged = `${header}.${payload}.${base64Url(crypto.randomBytes(64))}`;

    await assert.rejects(
        () => verifyPlatformEntitlement(forged, expectedBinding, { now, resolvePublicKey: async () => fixture.material }),
        (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_entitlement_invalid",
    );
    assert.ok(signature);

    const unknownKey = signedToken({ keyId: "wrong-key-id" }).token;
    await assert.rejects(
        () => verifyPlatformEntitlement(unknownKey, expectedBinding, { now, resolvePublicKey: async () => fixture.material }),
        (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_entitlement_key_mismatch",
    );
});

test("expired and future tickets are rejected", async () => {
    const expired = signedToken({ issuedAt: now - 11 * 60 * 1000, expiresAt: now - 1 });
    await assert.rejects(
        () => verifyPlatformEntitlement(expired.token, expectedBinding, { now, resolvePublicKey: async () => expired.material }),
        (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_entitlement_expired",
    );

    const future = signedToken({ issuedAt: now + 31_000, expiresAt: now + 90_000 });
    await assert.rejects(
        () => verifyPlatformEntitlement(future.token, expectedBinding, { now, resolvePublicKey: async () => future.material }),
        (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_entitlement_expired",
    );
});

test("origin, profile, client, issuer, and authority bindings cannot be changed", async () => {
    const fixture = signedToken();
    await assert.rejects(
        () => verifyPlatformEntitlement(fixture.token, { ...expectedBinding, origin: "https://www.sneeai.com" }, { now, resolvePublicKey: async () => fixture.material }),
        (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_entitlement_origin_not_allowed",
    );
    for (const expected of [
        { ...expectedBinding, profileId: "v1:user:user-2" },
        { ...expectedBinding, clientId: "client-2" },
        { ...expectedBinding, deviceId: `d1:${"b".repeat(43)}` },
        { ...expectedBinding, instanceKey: `i1:${"c".repeat(43)}` },
    ]) {
        await assert.rejects(
            () => verifyPlatformEntitlement(fixture.token, expected, { now, resolvePublicKey: async () => fixture.material }),
            (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_entitlement_binding_mismatch",
        );
    }

    const wrongIssuer = { ...fixture.material, issuer: "https://issuer.example" };
    await assert.rejects(
        () => verifyPlatformEntitlement(fixture.token, expectedBinding, { now, resolvePublicKey: async () => wrongIssuer }),
        (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_entitlement_key_mismatch",
    );

    await assert.rejects(
        () => verifyPlatformEntitlement(fixture.token, { ...expectedBinding, origin: "https://evil.example" }, { now, resolvePublicKey: async () => fixture.material }),
        (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_entitlement_origin_not_allowed",
    );
    assert.equal(canResolveEntitlementAuthority("https://evil.example"), false);

    const crossUser = signedToken({ subject: "user-2" });
    await assert.rejects(
        () => verifyPlatformEntitlement(crossUser.token, expectedBinding, { now, resolvePublicKey: async () => crossUser.material }),
        (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_entitlement_binding_mismatch",
    );
});

test("authorization version and minimum Agent version are enforced", async () => {
    const staleAgent = signedToken({ minimumAgentVersion: "0.3.3" });
    await assert.rejects(
        () => verifyPlatformEntitlement(staleAgent.token, expectedBinding, { now, resolvePublicKey: async () => staleAgent.material }),
        (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_entitlement_agent_version_too_old",
    );

    const prerelease = signedToken({ minimumAgentVersion: "0.3.2" });
    await assert.rejects(
        () => verifyPlatformEntitlement(prerelease.token, { ...expectedBinding, agentVersion: "0.3.2-rc.1" }, { now, resolvePublicKey: async () => prerelease.material }),
        (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_entitlement_agent_version_too_old",
    );

    const invalidVersion = signedToken({ authorizationVersion: 0 });
    await assert.rejects(
        () => verifyPlatformEntitlement(invalidVersion.token, expectedBinding, { now, resolvePublicKey: async () => invalidVersion.material }),
        (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_entitlement_invalid",
    );
});

test("official web origins always require entitlement, while local development can opt in", () => {
    assert.equal(entitlementRequired("https://sneeai.com"), true);
    assert.equal(entitlementRequired("https://www.sneeai.com"), true);
    assert.equal(entitlementRequired("http://127.0.0.1:3000"), false);
    assert.equal(canResolveEntitlementAuthority("http://127.0.0.1:3000"), true);
    assert.equal(canUsePersistentToken(""), true);
    assert.equal(canUsePersistentToken("http://127.0.0.1:3000"), true);
    assert.equal(canUsePersistentToken("https://sneeai.com"), false);
    assert.equal(canUsePersistentToken("https://evil.example"), false);
});

test("Agent pairing identity is stable across restarts and isolated across local secrets", () => {
    const first = createAgentPairingIdentity("a".repeat(36));
    const restarted = createAgentPairingIdentity("a".repeat(36));
    const replacement = createAgentPairingIdentity("b".repeat(36));

    assert.equal(first.instanceKey, restarted.instanceKey);
    assert.equal(first.instancePublicKey, restarted.instancePublicKey);
    assert.notEqual(first.instanceKey, replacement.instanceKey);
    assert.match(first.instanceKey, /^i1:[A-Za-z0-9_-]{43}$/);
    assert.match(first.instancePublicKey, /^[A-Za-z0-9_-]{43}$/);
});

test("only the challenged Agent instance can produce the bound pairing proof", async () => {
    const identity = createAgentPairingIdentity("a".repeat(36));
    const replacement = createAgentPairingIdentity("b".repeat(36));
    const binding = { origin, profileId, clientId, deviceId, agentVersion };
    const fixture = signedPairingChallenge(identity.instanceKey);
    const proof = await identity.prove(fixture.token, binding, { now, resolvePublicKey: async () => fixture.material });
    const publicKey = crypto.createPublicKey({
        key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(identity.instancePublicKey, "base64url")]),
        format: "der",
        type: "spki",
    });
    assert.equal(crypto.verify(null, Buffer.from(`sneeai-agent-pairing-proof-v1\0${fixture.token}`), publicKey, Buffer.from(proof, "base64url")), true);

    await assert.rejects(
        () => replacement.prove(fixture.token, binding, { now, resolvePublicKey: async () => fixture.material }),
        (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_pairing_challenge_invalid",
    );
    await assert.rejects(
        () => identity.prove(fixture.token, { ...binding, clientId: "client-2" }, { now, resolvePublicKey: async () => fixture.material }),
        (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_pairing_challenge_invalid",
    );
});

test("pairing confirmation binds the browser nonce and both tickets to one Agent instance", () => {
    const identity = createAgentPairingIdentity("a".repeat(36));
    const replacement = createAgentPairingIdentity("b".repeat(36));
    const nonce = crypto.randomBytes(32).toString("base64url");
    const entitlement = "platform-entitlement";
    const pairingTicket = "cat1.local-pairing-ticket";
    const confirmation = identity.confirm(nonce, entitlement, pairingTicket);
    const publicKey = crypto.createPublicKey({
        key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(identity.instancePublicKey, "base64url")]),
        format: "der",
        type: "spki",
    });

    assert.equal(crypto.verify(null, pairingConfirmationMessage(nonce, entitlement, pairingTicket), publicKey, Buffer.from(confirmation, "base64url")), true);
    assert.equal(crypto.verify(null, pairingConfirmationMessage(`${nonce.slice(0, -1)}A`, entitlement, pairingTicket), publicKey, Buffer.from(confirmation, "base64url")), false);
    assert.equal(crypto.verify(null, pairingConfirmationMessage(nonce, entitlement, `${pairingTicket}-forged`), publicKey, Buffer.from(confirmation, "base64url")), false);
    assert.equal(
        crypto.verify(null, pairingConfirmationMessage(nonce, entitlement, pairingTicket), publicKey, Buffer.from(replacement.confirm(nonce, entitlement, pairingTicket), "base64url")),
        false,
    );
});

function signedToken(overrides: { issuedAt?: number; expiresAt?: number; issuer?: string; keyId?: string; authorizationVersion?: number; minimumAgentVersion?: string; subject?: string } = {}) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const rawPublicKey = Buffer.from(publicKey.export({ format: "der", type: "spki" })).subarray(-32);
    const computedKeyId = crypto.createHash("sha256").update(rawPublicKey).digest("base64url").slice(0, 16);
    const header = { alg: "EdDSA", typ: "JWT", kid: overrides.keyId || computedKeyId };
    const issuedAt = Math.floor((overrides.issuedAt ?? now - 10_000) / 1000);
    const expiresAt = Math.floor((overrides.expiresAt ?? now + 110_000) / 1000);
    const payload = {
        version: 1,
        iss: overrides.issuer || origin,
        aud: "sneeai-agent",
        sub: overrides.subject || "user-1",
        scope: "agent:connect",
        origin,
        profile_id: profileId,
        client_id: clientId,
        device_id: deviceId,
        instance_key: instanceKey,
        authorization_version: overrides.authorizationVersion ?? 7,
        minimum_agent_version: overrides.minimumAgentVersion || "0.3.0",
        iat: issuedAt,
        exp: expiresAt,
        jti: "ticket-1",
    };
    const encodedHeader = base64Url(JSON.stringify(header));
    const encodedPayload = base64Url(JSON.stringify(payload));
    const unsigned = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto.sign(null, Buffer.from(unsigned), privateKey);
    const material: PublicKeyMaterial = {
        keyId: computedKeyId,
        algorithm: "EdDSA",
        issuer: overrides.issuer || origin,
        keyObject: publicKey,
    };
    return { token: `${unsigned}.${base64Url(signature)}`, material };
}

function signedPairingChallenge(challengedInstanceKey: string) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const rawPublicKey = Buffer.from(publicKey.export({ format: "der", type: "spki" })).subarray(-32);
    const keyId = crypto.createHash("sha256").update(rawPublicKey).digest("base64url").slice(0, 16);
    const header = base64Url(JSON.stringify({ alg: "EdDSA", typ: "agent-pairing-challenge+jwt", kid: keyId }));
    const issuedAt = Math.floor((now - 10_000) / 1000);
    const payload = base64Url(JSON.stringify({
        version: 1,
        iss: origin,
        aud: "sneeai-agent-pairing",
        sub: "user-1",
        scope: "agent:pairing:prove",
        origin,
        profile_id: profileId,
        client_id: clientId,
        device_id: deviceId,
        agent_version: agentVersion,
        instance_key: challengedInstanceKey,
        iat: issuedAt,
        exp: issuedAt + 30,
        jti: "challenge-1",
    }));
    const unsigned = `${header}.${payload}`;
    const material: PublicKeyMaterial = { keyId, algorithm: "EdDSA", issuer: origin, keyObject: publicKey };
    return { token: `${unsigned}.${crypto.sign(null, Buffer.from(unsigned), privateKey).toString("base64url")}`, material };
}

function base64Url(value: string | Uint8Array) {
    return Buffer.from(value).toString("base64url");
}
