import assert from "node:assert/strict";
import test from "node:test";

import { EntitlementLeaseRegistry } from "./entitlement-lease.js";
import { EntitlementVerificationError, type PlatformEntitlementClaims } from "./entitlement.js";

const profileKey = `p1:${"a".repeat(64)}`;
let now = 1_000;

test("renewal extends the lease and expiry stops only the latest session", () => {
    now = 1_000;
    const ended: string[] = [];
    const registry = new EntitlementLeaseRegistry((_profile, reason) => ended.push(reason), () => now);
    registry.renew(profileKey, claims({ expiresAt: 2_000 }));
    const renewed = registry.renew(profileKey, claims({ expiresAt: 3_000 }));

    now = 2_001;
    registry.expire();
    assert.equal(registry.authorize(profileKey, firstOrigin(), renewed), true);
    assert.deepEqual(ended, []);

    now = 3_001;
    registry.expire();
    assert.equal(registry.authorize(profileKey, firstOrigin(), renewed), false);
    assert.deepEqual(ended, ["expired"]);
    registry.dispose();
});

test("authorization versions cannot roll back and a newer version replaces the live session", () => {
    now = 1_000;
    const ended: string[] = [];
    const registry = new EntitlementLeaseRegistry((_profile, reason) => ended.push(reason), () => now);
    const oldAuthorization = registry.renew(profileKey, claims({ version: 4, expiresAt: 4_000 }));
    const nextAuthorization = registry.renew(profileKey, claims({ version: 5, expiresAt: 4_000 }));

    assert.deepEqual(ended, ["superseded"]);
    assert.equal(registry.authorize(profileKey, firstOrigin(), oldAuthorization), false);
    assert.equal(registry.authorize(profileKey, firstOrigin(), nextAuthorization), true);
    assert.throws(
        () => registry.renew(profileKey, claims({ version: 4, expiresAt: 4_000 })),
        (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_entitlement_stale",
    );
    registry.dispose();
});

test("a profile cannot switch entitlement subject or device", () => {
    now = 1_000;
    const registry = new EntitlementLeaseRegistry(() => undefined, () => now);
    registry.renew(profileKey, claims({ expiresAt: 4_000 }));

    for (const changed of [claims({ subject: "user-2", expiresAt: 4_000 }), claims({ deviceId: `d1:${"c".repeat(43)}`, expiresAt: 4_000 })]) {
        assert.throws(
            () => registry.renew(profileKey, changed),
            (error: unknown) => error instanceof EntitlementVerificationError && error.code === "agent_entitlement_binding_mismatch",
        );
    }
    registry.dispose();
});

function claims(overrides: { version?: number; expiresAt: number; subject?: string; deviceId?: string }): PlatformEntitlementClaims {
    return {
        version: 1,
        iss: firstOrigin(),
        aud: "sneeai-agent",
        sub: overrides.subject || "user-1",
        scope: "agent:connect",
        origin: firstOrigin(),
        profile_id: "v1:user:user-1",
        client_id: "client-1",
        device_id: overrides.deviceId || `d1:${"b".repeat(43)}`,
        instance_key: `i1:${"c".repeat(43)}`,
        authorization_version: overrides.version || 4,
        minimum_agent_version: "0.3.0",
        iat: 0,
        exp: overrides.expiresAt / 1000,
        jti: "ticket-1",
    };
}

function firstOrigin() {
    return "https://sneeai.com";
}
