import assert from "node:assert/strict";
import test from "node:test";

import { claudeInvocation } from "./claude.js";

test("Windows Claude launch keeps hostile prompt text out of fixed argv and writes it to stdin", () => {
    const prompt = 'hello & whoami | powershell -c "throw" %PATH%';
    const invocation = claudeInvocation(prompt, "win32");

    assert.equal(invocation.command, "claude");
    assert.deepEqual(invocation.args, ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--allowedTools", "mcp__sneeai-agent__*"]);
    assert.equal(invocation.shell, false);
    assert.equal(invocation.args.some((value) => value.includes(prompt)), false);
    assert.match(invocation.stdin, /Sneeai Agent/);
    assert.ok(invocation.stdin.endsWith(`用户请求：${prompt}`));

    const unixInvocation = claudeInvocation(prompt, "darwin");
    assert.equal(unixInvocation.shell, false);
    assert.deepEqual(unixInvocation.args, invocation.args);
});
