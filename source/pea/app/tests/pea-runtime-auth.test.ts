import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  authenticatePeaRuntimeMethod,
  describePeaRuntimeAuth,
  logoutPeaRuntimeAuth,
  toAcpAuthMethods,
  toAgUiAuthCapabilities,
} from "../pea-runtime-auth.js";
import { probeOpenAiAuth } from "../beta-auth-bootstrap.js";

describe("Pea runtime auth", () => {
  it("describes default API-key auth for Pea", () => {
    const auth = describePeaRuntimeAuth({ runtimeId: "pea" });

    assert.equal(auth.authSource, "api-key");
    assert.equal(auth.logoutSupported, true);
    assert.deepEqual(toAcpAuthMethods(auth), [
      {
        type: "env_var",
        id: "openai-api-key",
        name: "OpenAI API key",
        description:
          "Use OPENAI_API_KEY or stored MastraCode API-key credentials for Pea runtime model access.",
        vars: [
          {
            name: "OPENAI_API_KEY",
            label: "OpenAI API key",
            secret: true,
            optional: false,
          },
        ],
      },
    ]);
  });

  it("normalizes stored Pea API-key auth over stale OAuth credentials", async () => {
    const originalProcessKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const temp = await mkdtemp(join(tmpdir(), "pea-auth-"));
    const authPath = join(temp, "auth.json");
    await writeFile(
      authPath,
      JSON.stringify(
        {
          "openai-codex": { type: "oauth", refresh_token: "stale-oauth" },
          "apikey:openai-codex": { type: "api_key", key: "stored-key" },
        },
        null,
        2,
      ),
      "utf-8",
    );

    try {
      const probe = await probeOpenAiAuth("api-key", false, authPath);

      assert.deepEqual(probe, {
        isConfigured: true,
        source: "MastraCode auth.json",
      });
      assert.equal(process.env.OPENAI_API_KEY, "stored-key");
      const parsed = JSON.parse(await readFile(authPath, "utf-8")) as Record<
        string,
        unknown
      >;
      assert.deepEqual(parsed["openai-codex"], {
        type: "api_key",
        key: "stored-key",
      });
      assert.deepEqual(parsed["apikey:openai-codex"], {
        type: "api_key",
        key: "stored-key",
      });
    } finally {
      if (originalProcessKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalProcessKey;
      }
    }
  });

  it("removes only scoped Pea OpenAI credentials during logout", async () => {
    const originalProcessKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "process-key";
    const temp = await mkdtemp(join(tmpdir(), "pea-auth-"));
    const authPath = join(temp, "auth.json");
    await writeFile(
      authPath,
      JSON.stringify(
        {
          "openai-codex": { type: "api_key", key: "stored-key" },
          "apikey:openai-codex": { type: "api_key", key: "stored-key" },
          unrelated: { type: "api_key", key: "keep" },
        },
        null,
        2,
      ),
      "utf-8",
    );

    try {
      await logoutPeaRuntimeAuth({
        runtimeId: "pea",
        authSource: "api-key",
        mastraAuthPath: authPath,
      });

      const parsed = JSON.parse(await readFile(authPath, "utf-8")) as Record<
        string,
        unknown
      >;
      assert.equal(parsed["openai-codex"], undefined);
      assert.equal(parsed["apikey:openai-codex"], undefined);
      assert.deepEqual(parsed.unrelated, { type: "api_key", key: "keep" });
      assert.equal(process.env.OPENAI_API_KEY, undefined);
    } finally {
      if (originalProcessKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalProcessKey;
      }
    }
  });

  it("describes OAuth auth and rejects unknown authenticate method ids", () => {
    const auth = describePeaRuntimeAuth({
      runtimeId: "peco",
      authSource: "oauth",
    });

    assert.deepEqual(toAgUiAuthCapabilities(auth), {
      "pea.authSource": "oauth",
      "pea.logoutSupported": false,
      "pea.authMethods": [
        { id: "codex-oauth", kind: "agent", name: "Codex OAuth" },
      ],
    });
    authenticatePeaRuntimeMethod(auth, "codex-oauth");
    assert.throws(
      () => authenticatePeaRuntimeMethod(auth, "openai-api-key"),
      /Unsupported Pea runtime auth method/,
    );
  });
});
