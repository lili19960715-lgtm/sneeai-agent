import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { createAgentTicket } from "./pairing-ticket.js";
import { ToolAuthorizationVerificationError, verifyToolAuthorization, type ToolAuthorizationBinding } from "./tool-authorization.js";

const origin = "https://sneeai.com";
const now = 1_800_000_000_000;
const nowSeconds = Math.floor(now / 1000);
const expected: ToolAuthorizationBinding = {
    origin,
    profileId: "v1:user:user-1",
    clientId: "client-1",
    deviceId: `d1:${"a".repeat(43)}`,
    subject: "user-1",
    authorizationVersion: 7,
    operationId: "11111111-1111-4111-8111-111111111111",
    commitment: crypto.randomBytes(32).toString("base64url"),
};

test("a valid agent-action JWT authorizes exactly its bound operation", async () => {
    const fixture = signedAction();
    const claims = await verify(fixture);

    assert.equal(claims.operation_id, expected.operationId);
    assert.equal(claims.commitment, expected.commitment);
    assert.equal(claims.operation_class, "agent_write");
    assert.equal(claims.jti, "action-jti-1");
});

test("forged, expired, oversized-lifetime, and wrongly typed permits are rejected", async (t) => {
    const valid = signedAction();
    const parts = valid.token.split(".");
    parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
    await t.test("forged signature", () => rejects(parts.join("."), valid));
    await t.test("expired", () => rejectsFixture(signedAction({ payload: { iat: nowSeconds - 10, exp: nowSeconds } })));
    await t.test("lifetime over ten seconds", () => rejectsFixture(signedAction({ payload: { iat: nowSeconds, exp: nowSeconds + 11 } })));
    await t.test("wrong typ", () => rejectsFixture(signedAction({ header: { typ: "JWT" } })));
});

test("action audience, scope, version, operation class, and every context binding are exact", async (t) => {
    const cases: Array<[string, Record<string, unknown>]> = [
        ["audience", { aud: "sneeai-agent" }],
        ["scope", { scope: "agent:connect" }],
        ["version", { version: 2 }],
        ["operation class", { operation_class: "agent_read" }],
        ["subject", { sub: "user-2" }],
        ["origin", { origin: "https://www.sneeai.com" }],
        ["profile", { profile_id: "v1:user:user-2" }],
        ["client", { client_id: "client-2" }],
        ["device", { device_id: `d1:${"b".repeat(43)}` }],
        ["authorization version", { authorization_version: 8 }],
        ["operation", { operation_id: "22222222-2222-4222-8222-222222222222" }],
        ["commitment", { commitment: crypto.randomBytes(32).toString("base64url") }],
    ];

    for (const [name, payload] of cases) {
        await t.test(name, () => rejectsFixture(signedAction({ payload })));
    }
});

test("connect entitlements and local pairing tickets cannot impersonate action permits", async () => {
    const connect = signedAction({
        header: { typ: "JWT" },
        payload: {
            aud: "sneeai-agent",
            scope: "agent:connect",
            minimum_agent_version: "0.3.2",
        },
    });
    await rejectsFixture(connect);

    const pairingTicket = createAgentTicket("local-connect-token", {
        kind: "pairing",
        origin,
        profileKey: `p1:${"c".repeat(64)}`,
        clientId: expected.clientId,
        now,
    });
    await assert.rejects(
        () => verifyToolAuthorization(pairingTicket, expected, { now, resolvePublicKey: async () => connect.material }),
        (error: unknown) => error instanceof ToolAuthorizationVerificationError,
    );
});

test("a permit for one concurrent operation cannot be exchanged with another", async () => {
    const first = signedAction();
    await assert.rejects(
        () => verifyToolAuthorization(first.token, {
            ...expected,
            operationId: "22222222-2222-4222-8222-222222222222",
            commitment: crypto.randomBytes(32).toString("base64url"),
        }, { now, resolvePublicKey: async () => first.material }),
        (error: unknown) => error instanceof ToolAuthorizationVerificationError && error.code === "tool_authorization_binding_mismatch",
    );
});

function signedAction(overrides: { header?: Record<string, unknown>; payload?: Record<string, unknown> } = {}) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const rawPublicKey = Buffer.from(publicKey.export({ format: "der", type: "spki" })).subarray(-32);
    const keyId = crypto.createHash("sha256").update(rawPublicKey).digest("base64url").slice(0, 16);
    const header = { alg: "EdDSA", typ: "agent-action+jwt", kid: keyId, ...overrides.header };
    const payload = {
        version: 1,
        iss: origin,
        aud: "sneeai-agent-action",
        scope: "agent:tool:execute",
        sub: expected.subject,
        origin: expected.origin,
        profile_id: expected.profileId,
        client_id: expected.clientId,
        device_id: expected.deviceId,
        authorization_version: expected.authorizationVersion,
        operation_id: expected.operationId,
        operation_class: "agent_write",
        commitment: expected.commitment,
        iat: nowSeconds - 1,
        exp: nowSeconds + 9,
        jti: "action-jti-1",
        ...overrides.payload,
    };
    const encodedHeader = encode(header);
    const encodedPayload = encode(payload);
    const unsigned = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto.sign(null, Buffer.from(unsigned), privateKey).toString("base64url");
    return {
        token: `${unsigned}.${signature}`,
        material: { keyId, algorithm: "EdDSA" as const, issuer: origin, keyObject: publicKey },
    };
}

function verify(fixture: ReturnType<typeof signedAction>) {
    return verifyToolAuthorization(fixture.token, expected, { now, resolvePublicKey: async () => fixture.material });
}

function rejectsFixture(fixture: ReturnType<typeof signedAction>) {
    return rejects(fixture.token, fixture);
}

async function rejects(token: string, fixture: ReturnType<typeof signedAction>) {
    await assert.rejects(
        () => verifyToolAuthorization(token, expected, { now, resolvePublicKey: async () => fixture.material }),
        (error: unknown) => error instanceof ToolAuthorizationVerificationError,
    );
}

function encode(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}
