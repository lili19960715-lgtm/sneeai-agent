import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalAgentError, localAgentConfigPath, readLocalAgentConfig } from "./local-agent.js";

test("the bridge only reads the Sneeai Agent loopback configuration", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sneeai-bridge-"));
    const configDir = path.dirname(localAgentConfigPath(home));
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(localAgentConfigPath(home), JSON.stringify({ url: "http://127.0.0.1:17371", token: "local-token" }));
    assert.deepEqual(readLocalAgentConfig(home), { url: "http://127.0.0.1:17371", token: "local-token" });
});

test("the bridge rejects a missing Agent and non-loopback endpoints", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sneeai-bridge-"));
    assert.throws(() => readLocalAgentConfig(home), LocalAgentError);
    const configDir = path.dirname(localAgentConfigPath(home));
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(localAgentConfigPath(home), JSON.stringify({ url: "https://remote.example", token: "local-token" }));
    assert.throws(() => readLocalAgentConfig(home), /回环地址/);
});
