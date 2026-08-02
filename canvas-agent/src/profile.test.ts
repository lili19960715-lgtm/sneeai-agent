import assert from "node:assert/strict";
import test from "node:test";

import { LEGACY_PROFILE_KEY, resolveClientId, resolveProfile } from "./profile.js";

test("explicit account and device profiles are stable and origin-scoped", () => {
    const account = resolveProfile({ origin: "https://sneeai.com", headers: { "x-canvas-account-id": "account-1" } });
    const same = resolveProfile({ origin: "https://sneeai.com", headers: { "x-canvas-account-id": "account-1" } });
    const otherAccount = resolveProfile({ origin: "https://sneeai.com", headers: { "x-canvas-account-id": "account-2" } });
    const otherOrigin = resolveProfile({ origin: "http://localhost:3000", headers: { "x-canvas-account-id": "account-1" } });

    assert.equal(account.key, same.key);
    assert.notEqual(account.key, otherAccount.key);
    assert.notEqual(account.key, otherOrigin.key);
    assert.equal(account.source, "account");
});

test("legacy and canonical profile keys survive MCP forwarding", () => {
    assert.equal(resolveProfile({}).key, LEGACY_PROFILE_KEY);
    assert.equal(resolveProfile({ headers: { "x-canvas-profile-id": LEGACY_PROFILE_KEY } }).key, LEGACY_PROFILE_KEY);
    const canonical = `p1:${"c".repeat(64)}`;
    assert.equal(resolveProfile({ headers: { "x-canvas-profile-id": canonical } }).key, canonical);
});

test("invalid profile and client identifiers are rejected", () => {
    assert.throws(() => resolveProfile({ headers: { "x-canvas-profile-id": "bad\nprofile" } }), /invalid profile id/);
    assert.throws(() => resolveClientId({ headers: { "x-canvas-client-id": "x".repeat(201) } }), /invalid client id/);
});
