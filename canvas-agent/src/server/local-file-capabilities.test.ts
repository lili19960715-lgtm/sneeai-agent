import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalFileCapabilityError, LocalFileCapabilityRegistry, localFileCapabilityHandle } from "./local-file-capabilities.js";

test("local file handles are opaque, profile-bound, and expire", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-agent-files-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const filePath = path.join(root, "result.png");
    fs.writeFileSync(filePath, "image");
    let now = 1_000;
    const registry = new LocalFileCapabilityRegistry({ now: () => now, ttlMs: 100 });

    const reference = registry.issue("profile-a", root, filePath);
    assert.match(reference || "", /^canvas-agent-file:\/\/local\/lf1_[A-Za-z0-9_-]{43}\//);
    assert.equal(reference?.includes(root), false);
    assert.equal(registry.resolve("profile-a", reference || "").filePath, fs.realpathSync(filePath));
    assert.throws(() => registry.resolve("profile-b", reference || ""), (error: unknown) => error instanceof LocalFileCapabilityError && error.statusCode === 403);

    now += 101;
    assert.throws(() => registry.resolve("profile-a", reference || ""), (error: unknown) => error instanceof LocalFileCapabilityError && error.statusCode === 410);
});

test("paths outside the workspace and symlink escapes never receive handles", (t) => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-agent-boundary-"));
    t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
    const root = path.join(parent, "workspace");
    const outside = path.join(parent, "private.png");
    fs.mkdirSync(root);
    fs.writeFileSync(outside, "private");
    fs.symlinkSync(outside, path.join(root, "escape.png"));
    const registry = new LocalFileCapabilityRegistry();

    assert.equal(registry.issue("profile-a", root, outside), null);
    assert.equal(registry.issue("profile-a", root, path.join(root, "escape.png")), null);
});

test("payload protection replaces exact and markdown paths without exposing the path", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-agent-payload-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const filePath = path.join(root, "generated image.png");
    fs.writeFileSync(filePath, "image");
    const registry = new LocalFileCapabilityRegistry();

    const protectedPayload = registry.protectPayload("profile-a", root, {
        output: filePath,
        text: `结果：[打开文件](<${filePath}>)`,
    }) as { output: string; text: string };
    assert.ok(localFileCapabilityHandle(protectedPayload.output));
    assert.match(protectedPayload.text, /canvas-agent-file:\/\/local\/lf1_/);
    assert.equal(JSON.stringify(protectedPayload).includes(root), false);
});

test("changing a file invalidates its existing handle", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-agent-replace-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const filePath = path.join(root, "result.png");
    fs.writeFileSync(filePath, "first");
    const registry = new LocalFileCapabilityRegistry();
    const reference = registry.issue("profile-a", root, filePath) || "";
    fs.rmSync(filePath);
    fs.writeFileSync(filePath, "second");

    assert.throws(() => registry.resolve("profile-a", reference), (error: unknown) => error instanceof LocalFileCapabilityError && error.statusCode === 410);
});
