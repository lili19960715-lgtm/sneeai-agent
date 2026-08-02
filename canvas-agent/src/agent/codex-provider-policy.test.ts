import assert from "node:assert/strict";
import test from "node:test";

import { KAPEAI_RELAY_BASE_URL, evaluateCodexProviderPolicy } from "./codex-provider-policy.js";

const apiKeyAccount = { type: "apiKey" } as const;

function customProvider(baseUrl: string) {
    return { model_provider: "custom", model_providers: { custom: { name: "KapeAI", base_url: baseUrl } } };
}

test("API-key Codex users are allowed through the configured KapeAI relay", () => {
    const decision = evaluateCodexProviderPolicy({ account: apiKeyAccount, config: customProvider(`${KAPEAI_RELAY_BASE_URL}/`) });

    assert.deepEqual(decision, { kind: "relay" });
});

test("ChatGPT subscription users can use the official OpenAI provider directly", () => {
    const decision = evaluateCodexProviderPolicy({ account: { type: "chatgpt" }, config: { model_provider: "openai" }, env: {} });

    assert.deepEqual(decision, { kind: "subscription" });
});

test("a ChatGPT login does not bypass relay restrictions for a custom provider", () => {
    const blocked = evaluateCodexProviderPolicy({
        account: { type: "chatgpt" },
        config: customProvider("https://another.example/v1"),
        env: {},
    });
    const allowed = evaluateCodexProviderPolicy({
        account: { type: "chatgpt" },
        config: customProvider(KAPEAI_RELAY_BASE_URL),
        env: {},
    });

    assert.equal(blocked.kind, "blocked");
    assert.deepEqual(allowed, { kind: "relay" });
});

test("a ChatGPT login does not bypass a base URL environment override", () => {
    const decision = evaluateCodexProviderPolicy({
        account: { type: "chatgpt" },
        config: { model_provider: "openai" },
        env: { OPENAI_BASE_URL: "https://another.example/v1" },
    });

    assert.equal(decision.kind, "blocked");
});

test("API-key Codex users are rejected when the active provider is not KapeAI", () => {
    const decision = evaluateCodexProviderPolicy({ account: apiKeyAccount, config: customProvider("https://another.example/v1") });

    assert.equal(decision.kind, "blocked");
});

test("direct OpenAI API mode is rejected without an allowed base URL", () => {
    const decision = evaluateCodexProviderPolicy({ account: apiKeyAccount, config: { model_provider: "openai" } });

    assert.equal(decision.kind, "blocked");
});

test("environment base URL overrides are checked as part of the active provider", () => {
    const wrong = evaluateCodexProviderPolicy({
        account: apiKeyAccount,
        config: customProvider(KAPEAI_RELAY_BASE_URL),
        env: { OPENAI_BASE_URL: "https://another.example/v1" },
    });
    const allowed = evaluateCodexProviderPolicy({
        account: apiKeyAccount,
        config: { model_provider: "openai", openai_base_url: KAPEAI_RELAY_BASE_URL },
        env: { OPENAI_BASE_URL: `${KAPEAI_RELAY_BASE_URL}/` },
    });

    assert.equal(wrong.kind, "blocked");
    assert.deepEqual(allowed, { kind: "relay" });
});

test("relay matching requires HTTPS and the exact API path", () => {
    const urls = [
        "http://api.kapeai.cn/v1",
        "https://api.kapeai.cn/v1/other",
        "https://api.kapeai.cn.evil.example/v1",
        "https://api.kapeai.cn/v1?forward=another.example",
    ];

    urls.forEach((baseUrl) => {
        const decision = evaluateCodexProviderPolicy({ account: apiKeyAccount, config: customProvider(baseUrl) });
        assert.equal(decision.kind, "blocked", baseUrl);
    });
});
