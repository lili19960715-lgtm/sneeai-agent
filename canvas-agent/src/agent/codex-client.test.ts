import assert from "node:assert/strict";
import test from "node:test";

import { codexConfig } from "./codex-client.js";
import { CANVAS_AGENT_PROFILE_ENV, NESTED_CANVAS_MCP_ENV } from "./codex-runtime.js";
import { STABLE_USER_HOME } from "../config.js";

test("Codex threads explicitly start the nested Canvas MCP with a cold-start allowance", () => {
    const server = codexConfig("request").mcp_servers["sneeai-agent"];

    assert.deepEqual(server.env, { [NESTED_CANVAS_MCP_ENV]: "1", CANVAS_AGENT_HOME: STABLE_USER_HOME });
    assert.equal(server.required, true);
    assert.equal(server.startup_timeout_sec, 60);
});

test("Codex threads bind their nested Canvas MCP to the originating profile", () => {
    const server = codexConfig("request", "profile-a").mcp_servers["sneeai-agent"];

    assert.deepEqual(server.env, { [NESTED_CANVAS_MCP_ENV]: "1", CANVAS_AGENT_HOME: STABLE_USER_HOME, [CANVAS_AGENT_PROFILE_ENV]: "profile-a" });
});
