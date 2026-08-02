import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { VERSION } from "./config.js";
import { canvasConnectionUrl, probeAgent } from "./pairing.js";
import { protocolMetadata, PROTOCOL_CAPABILITIES, PROTOCOL_VERSION } from "./protocol.js";

const config = { url: "http://127.0.0.1:17371", token: "local token" };

test("pairing URL preserves the requested canvas mode and adds only the local Agent address", () => {
    const url = new URL(canvasConnectionUrl("https://sneeai.com/canvas?mode=recent&source=agent", config));
    assert.equal(url.origin, "https://sneeai.com");
    assert.equal(url.pathname, "/canvas");
    assert.equal(url.searchParams.get("mode"), "recent");
    assert.equal(url.searchParams.get("source"), "agent");
    assert.equal(url.searchParams.has("agentUrl"), false);
    assert.equal(url.searchParams.has("agentToken"), false);
    const fragment = new URLSearchParams(url.hash.slice(1));
    assert.equal(fragment.get("agentUrl"), config.url);
    assert.equal(fragment.has("agentToken"), false);
});

test("pairing URL removes legacy query and fragment credentials", () => {
    const url = new URL(canvasConnectionUrl("https://sneeai.com/canvas?mode=recent&agentUrl=https%3A%2F%2Fold.example&agentToken=old-secret#panel=agent", config));
    assert.equal(url.searchParams.has("agentUrl"), false);
    assert.equal(url.searchParams.has("agentToken"), false);
    const fragment = new URLSearchParams(url.hash.slice(1));
    assert.equal(fragment.get("panel"), "agent");
    assert.equal(fragment.get("agentUrl"), config.url);
    assert.equal(fragment.has("agentToken"), false);
});

test("pairing URL defaults to a new canvas", () => {
    const url = new URL(canvasConnectionUrl("http://localhost:3000/canvas", config));
    assert.equal(url.searchParams.get("mode"), "new");
});

test("pairing URL rejects non-web protocols", () => {
    assert.throws(() => canvasConnectionUrl("file:///tmp/canvas.html", config), /HTTP/);
});

test("Agent probe requires the protected endpoint to accept the saved token", async (t) => {
    const server = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        if (req.url === "/health") return void res.end(JSON.stringify({ ok: true, service: "sneeai-agent", version: VERSION, ...protocolMetadata(VERSION) }));
        if (req.url === "/agent/codex/workspace" && req.headers["x-canvas-agent-token"] === config.token) return void res.end(JSON.stringify({ ok: true }));
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const localConfig = { ...config, url: `http://127.0.0.1:${address.port}` };

    assert.equal(await probeAgent(localConfig), "ready");
    assert.equal(await probeAgent({ ...localConfig, token: "wrong" }), "unauthorized");
});

test("Agent probe tolerates a busy local runtime", async (t) => {
    const server = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        if (req.url === "/health") {
            setTimeout(() => res.end(JSON.stringify({ ok: true, service: "sneeai-agent", version: VERSION, ...protocolMetadata(VERSION) })), 1_000);
            return;
        }
        if (req.url === "/agent/codex/workspace" && req.headers["x-canvas-agent-token"] === config.token) return void res.end(JSON.stringify({ ok: true }));
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    assert.equal(await probeAgent({ ...config, url: `http://127.0.0.1:${address.port}` }), "ready");
});

test("Agent probe reports a provider-policy rejection separately from token failure", async (t) => {
    const server = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        if (req.url === "/health") return void res.end(JSON.stringify({ ok: true, service: "sneeai-agent", version: VERSION, ...protocolMetadata(VERSION) }));
        if (req.url === "/agent/codex/workspace") {
            res.statusCode = 403;
            return void res.end(JSON.stringify({ ok: false, code: "codex_provider_not_allowed" }));
        }
        res.statusCode = 404;
        res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    assert.equal(await probeAgent({ ...config, url: `http://127.0.0.1:${address.port}` }), "provider-blocked");
});

test("Agent probe reports a missing independent relay key", async (t) => {
    const server = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        if (req.url === "/health") return void res.end(JSON.stringify({ ok: true, service: "sneeai-agent", version: VERSION, ...protocolMetadata(VERSION) }));
        if (req.url === "/agent/codex/workspace") {
            res.statusCode = 428;
            return void res.end(JSON.stringify({ ok: false, code: "relay_api_key_required" }));
        }
        res.statusCode = 404;
        res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    assert.equal(await probeAgent({ ...config, url: `http://127.0.0.1:${address.port}` }), "api-key-required");
});

test("Agent probe rejects another service that only imitates the health response", async (t) => {
    const server = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        if (req.url === "/health") return void res.end(JSON.stringify({ ok: true }));
        if (req.url === "/agent/codex/workspace") return void res.end(JSON.stringify({ ok: true }));
        res.statusCode = 404;
        res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    assert.equal(await probeAgent({ ...config, url: `http://127.0.0.1:${address.port}` }), "incompatible");
});

test("Agent probe rejects a running Agent from another package version", async (t) => {
    const server = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        if (req.url === "/health") return void res.end(JSON.stringify({ ok: true, service: "sneeai-agent", version: "0.3.0" }));
        if (req.url === "/agent/codex/workspace") return void res.end(JSON.stringify({ ok: true }));
        res.statusCode = 404;
        res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    assert.equal(await probeAgent({ ...config, url: `http://127.0.0.1:${address.port}` }), "incompatible");
});

test("Agent probe negotiates protocol capabilities independently of build version", async (t) => {
    const server = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        if (req.url === "/health") return void res.end(JSON.stringify({ ok: true, service: "sneeai-agent", ...protocolMetadata("99.0.0") }));
        if (req.url === "/agent/codex/workspace") return void res.end(JSON.stringify({ ok: true }));
        res.statusCode = 404;
        res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    assert.equal(await probeAgent({ ...config, url: `http://127.0.0.1:${address.port}` }), "ready");
    assert.equal(PROTOCOL_VERSION, 1);
    assert.ok(PROTOCOL_CAPABILITIES.includes("pairing.ticket.v1"));
});

test("Agent probe rejects a modern response with a missing capability", async (t) => {
    const server = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        if (req.url === "/health") return void res.end(JSON.stringify({ ok: true, service: "sneeai-agent", protocolVersion: PROTOCOL_VERSION, buildVersion: VERSION, capabilities: ["health.v1"] }));
        res.statusCode = 404;
        res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    assert.equal(await probeAgent({ ...config, url: `http://127.0.0.1:${address.port}` }), "incompatible");
});
