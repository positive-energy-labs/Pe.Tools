import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { Effect } from "effect";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  harnessEndpointEnv,
  readInferenceEndpoint,
  saveInferenceEndpoint,
} from "../src/inference-endpoint.ts";
import { productInferenceEndpointPath } from "../src/product-paths.ts";

/** One fake upstream; `mode` picks how it fails. */
let mode: "ok" | "no-models" | "chat-fails" = "ok";
let server: Server;
let baseUrl = "";
let home = "";
const priorLocalAppData = process.env.LOCALAPPDATA;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "pe-inference-"));
  process.env.LOCALAPPDATA = home;
  server = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer sk-test-1234")
      return res.writeHead(401).end("bad key");
    if (req.url === "/v1/models")
      return res
        .writeHead(200)
        .end(JSON.stringify({ data: mode === "no-models" ? [] : [{ id: "gpt-6-sol" }] }));
    if (mode === "chat-fails") return res.writeHead(500).end("upstream exploded");
    res.writeHead(200).end(
      JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  process.env.LOCALAPPDATA = priorLocalAppData;
  await rm(home, { recursive: true, force: true });
});

const save = (apiKey = "sk-test-1234") =>
  Effect.runPromise(Effect.flip(saveInferenceEndpoint({ baseUrl, apiKey })));

test("the first served model that answers one chat is saved, handed to the codex child only, and read back redacted", async () => {
  mode = "ok";
  const saved = await Effect.runPromise(
    saveInferenceEndpoint({ baseUrl: `${baseUrl}/`, apiKey: "sk-test-1234" }),
  );
  expect(saved).toMatchObject({
    baseUrl: `${baseUrl}/v1`,
    apiKeyRedacted: "…1234",
    probe: { model: "gpt-6-sol" },
  });
  // The host's own env never carries the endpoint; only the codex child env does.
  expect(process.env.OPENAI_BASE_URL).not.toBe(`${baseUrl}/v1`);
  expect(harnessEndpointEnv("claude")).toEqual({});
  const codex = harnessEndpointEnv("codex");
  expect(codex).toMatchObject({
    MODEL_PROVIDER: "pea_endpoint",
    PEA_ENDPOINT_API_KEY: "sk-test-1234",
  });
  expect(JSON.parse(codex.CODEX_CONFIG!)).toMatchObject({
    model_provider: "pea_endpoint",
    model_providers: { pea_endpoint: { base_url: `${baseUrl}/v1`, wire_api: "responses" } },
  });
  expect(await Effect.runPromise(readInferenceEndpoint())).toEqual(saved);
  await rm(productInferenceEndpointPath());
});

test("models 200 with an empty data[] names the models step and saves nothing", async () => {
  mode = "no-models";
  expect((await save()).message).toMatch(
    /models step failed: HTTP 200 but data\[\] lists no model/,
  );
  expect(existsSync(productInferenceEndpointPath())).toBe(false);
});

test("a failing chat names the chat step with the upstream status and body, and saves nothing", async () => {
  mode = "chat-fails";
  expect((await save()).message).toMatch(/chat step failed: HTTP 500 .*upstream exploded/);
  expect(existsSync(productInferenceEndpointPath())).toBe(false);
});

test("a wrong key fails at the models step; a non-/v1 path fails at the url step", async () => {
  mode = "ok";
  expect((await save("sk-wrong")).message).toMatch(/models step failed: HTTP 401 .*bad key/);
  const url = await Effect.runPromise(
    Effect.flip(saveInferenceEndpoint({ baseUrl: `${baseUrl}/api`, apiKey: "sk-test-1234" })),
  );
  expect(url.message).toMatch(/url step failed: path must be empty or end in \/v1, got \/api/);
  expect(existsSync(productInferenceEndpointPath())).toBe(false);
});
