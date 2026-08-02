import assert from "node:assert/strict";
import test from "node:test";

import { threadMessages } from "./codex-history.js";

test("failed MCP history uses result content as the error message", () => {
    const messages = threadMessages({
        turns: [{
            id: "turn-1",
            status: "completed",
            items: [{
                id: "tool-1",
                type: "mcpToolCall",
                server: "node_repl",
                tool: "js",
                status: "failed",
                error: null,
                result: { content: [{ type: "text", text: "No browser is available" }] },
            }],
        }],
    });

    assert.equal(messages.length, 1);
    assert.equal(messages[0].title, "调用工具：js");
    assert.equal(messages[0].text, "No browser is available");
    assert.deepEqual(messages[0].detail, { kind: "tool", status: "failed", rows: [], output: "No browser is available" });
});
