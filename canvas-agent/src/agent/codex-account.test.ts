import test from "node:test";
import assert from "node:assert/strict";

import { classifyCodexAccount } from "./codex.js";

test("classifies ChatGPT subscription without exposing account details", () => {
    assert.deepEqual(classifyCodexAccount({ type: "chatgpt", planType: "pro", email: "hidden@example.com" } as never), {
        connected: true,
        authMode: "chatgpt",
        planType: "pro",
    });
});

test("classifies API key mode without returning the key", () => {
    assert.deepEqual(classifyCodexAccount({ type: "apiKey", apiKey: "secret" } as never), {
        connected: true,
        authMode: "apikey",
        planType: null,
    });
});

test("classifies logged out and unsupported accounts", () => {
    assert.deepEqual(classifyCodexAccount(null), { connected: false, authMode: null, planType: null });
    assert.deepEqual(classifyCodexAccount({ type: "bedrock" }), { connected: true, authMode: null, planType: null });
});
