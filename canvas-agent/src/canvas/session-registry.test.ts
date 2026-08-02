import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import assert from "node:assert/strict";
import test from "node:test";

import { CanvasSessionRegistry } from "./session-registry.js";

test("thread and workspace events never cross profile sessions", (t) => {
    const registry = new CanvasSessionRegistry();
    const first = connect(registry, "profile-a", "shared-client");
    const second = connect(registry, "profile-b", "shared-client");
    t.after(() => registry.dispose());

    registry.session("profile-a").emitThread("workspace_changed", "thread-a", { activeThreadId: "thread-a" });

    assert.deepEqual(first.event("workspace_changed"), { activeThreadId: "thread-a", threadId: "thread-a" });
    assert.equal(second.event("workspace_changed"), undefined);
    assert.equal(registry.health().clients, 2);
    assert.equal(registry.health().profiles, 2);
});

test("disposing an expired profile closes only its event streams", (t) => {
    const registry = new CanvasSessionRegistry();
    const first = connect(registry, "profile-a", "client-a");
    const second = connect(registry, "profile-b", "client-b");
    t.after(() => registry.dispose());

    assert.equal(registry.disposeProfile("profile-a"), true);
    assert.equal(first.closed, true);
    assert.equal(second.closed, false);
    assert.equal(registry.health().profiles, 1);
    assert.equal(registry.health().clients, 1);
});

test("disposing a profile rejects its proposals without dispatching them", async (t) => {
    const registry = new CanvasSessionRegistry();
    const first = connect(registry, "profile-a", "client-a");
    t.after(() => registry.dispose());
    const result = registry.session("profile-a").callTool("canvas_create_text_node", { text: "pending" });
    const outcome = result.then(() => "resolved", (error) => error instanceof Error ? error.message : String(error));

    assert.ok(first.event("tool_proposal"));
    assert.equal(first.event("tool_call"), undefined);
    registry.disposeProfile("profile-a", "lease expired");
    assert.match(await outcome, /lease expired/);
    assert.equal(first.event("tool_call"), undefined);
});

function connect(registry: CanvasSessionRegistry, profileKey: string, clientId: string) {
    const response = new FakeSseResponse();
    registry.session(profileKey).openEvents(new URL(`http://127.0.0.1/events?clientId=${clientId}`), response as unknown as ServerResponse);
    return response;
}

class FakeSseResponse extends EventEmitter {
    private chunks: string[] = [];
    closed = false;

    writeHead() {
        return this;
    }

    write(chunk: string) {
        this.chunks.push(chunk);
        return true;
    }

    event(type: string) {
        const chunk = this.chunks.find((item) => item.startsWith(`event: ${type}\n`));
        const data = chunk?.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
        return data ? JSON.parse(data) as unknown : undefined;
    }

    end() {
        this.closed = true;
        this.emit("close");
        return this;
    }
}
