import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "../dist/config/env.js";
import { sendXEnvelope } from "../dist/lib/xDelivery.js";
test("bot refresh persists rotated tokens securely and only retries definite authentication failure", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "hopfast-x-token-test-"),
  );
  env.X_CLIENT_ID = "fixture-client";
  env.X_CLIENT_SECRET = "fixture-secret";
  env.X_BOT_ACCESS_TOKEN = "expired-fixture";
  env.X_BOT_REFRESH_TOKEN = "fixture-refresh";
  env.X_BOT_TOKEN_STORE_PATH = path.join(directory, "tokens.json");
  const original = globalThis.fetch;
  let deliveries = 0,
    refreshes = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url) === "https://api.x.com/2/oauth2/token") {
      refreshes++;
      assert.equal(
        new URLSearchParams(options.body).get("grant_type"),
        "refresh_token",
      );
      return new Response(
        JSON.stringify({
          access_token: "fresh-fixture",
          refresh_token: "rotated-fixture",
        }),
        { status: 200 },
      );
    }
    deliveries++;
    if (options.headers.Authorization === "Bearer expired-fixture")
      return new Response("{}", { status: 401 });
    return new Response("{}", { status: deliveries === 2 ? 201 : 502 });
  };
  try {
    assert.equal((await sendXEnvelope("123", "fixture message")).status, 201);
    assert.equal(deliveries, 2);
    assert.equal(refreshes, 1);
    const saved = JSON.parse(
      await fs.readFile(env.X_BOT_TOKEN_STORE_PATH, "utf8"),
    );
    assert.equal(saved.refreshToken, "rotated-fixture");
    assert.equal(
      (await fs.stat(env.X_BOT_TOKEN_STORE_PATH)).mode & 0o777,
      0o600,
    );
    assert.equal((await sendXEnvelope("123", "fixture message")).status, 502);
    assert.equal(deliveries, 3);
    assert.equal(refreshes, 1);
  } finally {
    globalThis.fetch = original;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
