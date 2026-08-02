import assert from "node:assert/strict";
import test from "node:test";

import { authorizeAutomaticPairing, authorizeRequestOrigin } from "./cors.js";

test("the first authenticated browser origin is pinned", () => {
    const origins: string[] = [];
    assert.equal(authorizeRequestOrigin(origins, "https://sneeai.com", true), true);
    assert.deepEqual(origins, ["https://sneeai.com"]);
});

test("a different origin cannot join merely by presenting the token", () => {
    const origins = ["https://sneeai.com"];
    assert.equal(authorizeRequestOrigin(origins, "https://evil.example", true), false);
    assert.deepEqual(origins, ["https://sneeai.com"]);
});

test("configured origins remain allowed and invalid tokens cannot pin", () => {
    const origins = ["https://sneeai.com", "http://localhost:3100"];
    assert.equal(authorizeRequestOrigin(origins, "http://localhost:3100", false), true);
    assert.equal(authorizeRequestOrigin([], "https://evil.example", false), false);
});

test("automatic pairing trusts only the official Canvas origins by default", () => {
    assert.equal(authorizeAutomaticPairing("https://sneeai.com"), true);
    assert.equal(authorizeAutomaticPairing("https://www.sneeai.com"), false);
    for (const origin of ["http://127.0.0.1:3000", "http://localhost:3000", "http://127.0.0.1:3100", "http://localhost:3100"]) {
        assert.equal(authorizeAutomaticPairing(origin), true, origin);
    }
    assert.equal(authorizeAutomaticPairing("https://evil.example"), false);
    assert.equal(authorizeAutomaticPairing("https://attacker@sneeai.com"), false);
    assert.equal(authorizeAutomaticPairing("https://sneeai.com/path"), false);
    assert.equal(authorizeAutomaticPairing("http://localhost:3001"), false);
    assert.equal(authorizeAutomaticPairing("http://localhost:3000.evil.example"), false);
    assert.equal(authorizeAutomaticPairing("http://attacker@localhost:3000"), false);
    assert.equal(authorizeAutomaticPairing("http://localhost:3000/path"), false);
    assert.equal(authorizeAutomaticPairing("http://localhost:3000?next=/pair"), false);
    assert.equal(authorizeAutomaticPairing("http://localhost:3000#pair"), false);
});

test("automatic pairing accepts exact development origins from the environment", () => {
    const configured = "http://127.0.0.1:4173,https://preview.example";
    assert.equal(authorizeAutomaticPairing("http://127.0.0.1:4173", configured), true);
    assert.equal(authorizeAutomaticPairing("https://preview.example", configured), true);
    assert.equal(authorizeAutomaticPairing("http://localhost:4173", configured), false);
    assert.equal(authorizeAutomaticPairing("https://preview.example.evil.test", configured), false);
    assert.equal(authorizeAutomaticPairing("https://user@preview.example", configured), false);
    assert.equal(authorizeAutomaticPairing("https://preview.example/path", configured), false);
    assert.equal(authorizeAutomaticPairing("https://preview.example", "https://preview.example/path"), false);
});

test("automatic pairing accepts only exact loopback origins from saved configuration", () => {
    const savedOrigins = ["http://localhost:4173", "https://preview.example"];
    assert.equal(authorizeAutomaticPairing("http://localhost:4173", "", savedOrigins), true);
    assert.equal(authorizeAutomaticPairing("http://127.0.0.1:4173", "", savedOrigins), false);
    assert.equal(authorizeAutomaticPairing("https://preview.example", "", savedOrigins), false);
    assert.equal(authorizeAutomaticPairing("http://localhost:4173/path", "", savedOrigins), false);
});
