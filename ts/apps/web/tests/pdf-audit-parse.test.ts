/**
 * Guard 3 at the doc lab's parse route (ADR 0038): it uploads to LlamaCloud and can fetch a URL
 * to do it, so it runs only for the person the host proves. Mutant that turns the first test
 * red: in `src/routes/api/pdf-audit/parse.ts` delete the `isPersonRequest` check at the top of POST.
 */
import { HOST_CONTEXT_HEADER, HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { afterEach, expect, test, vi } from "vite-plus/test";

const parse = vi.hoisted(() => vi.fn());
// The proof (`isPersonRequest`) is real; only the upload is a spy.
vi.mock("@pe/mcps/llama-parse", async (actual) => ({
  ...(await actual<typeof import("@pe/mcps/llama-parse")>()),
  parseWithLlamaCloud: parse,
}));

import { Route } from "../src/routes/api/pdf-audit/parse";

const HOST = "http://127.0.0.1:45678";
const post = (
  Route.options as unknown as {
    server: { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } };
  }
).server.handlers.POST;
const request = (headers: Record<string, string> = {}) => {
  const form = new FormData();
  form.append("url", "https://example.test/secret.pdf");
  return new Request("http://127.0.0.1:3000/api/pdf-audit/parse", { method: "POST", body: form, headers });
};
/** The host's answer at `outward.person`; every other fetch is a URL fetch this route made. */
const host = (status: number) => {
  const fetched = vi.fn(async (input: string | URL, _init?: RequestInit) =>
    String(input) === `${HOST}/pe/outward/person`
      ? Response.json({ ok: status === 200 }, { status })
      : new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }),
  );
  vi.stubGlobal("fetch", fetched);
  return fetched;
};
const start = (hostUrl: string) => {
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", hostUrl);
  vi.stubEnv("PE_TOOLS_HOST_SERVICE_NAME", "svc");
  vi.stubEnv("LLAMA_CLOUD_API_KEY", "key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  parse.mockReset();
});

test("a POST with no proof of the person is held: no URL is fetched and LlamaCloud is not called", async () => {
  start(HOST);
  const fetched = host(403);
  const response = await post({ request: request() });
  expect(response.status).toBe(409);
  const { error } = (await response.json()) as { error: string };
  expect(error).toMatch(/^Held, not done/);
  expect(error).not.toMatch(/refus|reject|declin|denied/i);
  expect(parse).not.toHaveBeenCalled();
  expect(fetched.mock.calls.map(([url]) => String(url))).toEqual([`${HOST}/pe/outward/person`]);
});

test("no host to ask, or a host that does not answer, is not the person", async () => {
  start("");
  const fetched = host(200);
  expect((await post({ request: request() })).status).toBe(409);
  expect(fetched).not.toHaveBeenCalled();
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", HOST);
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
  expect((await post({ request: request() })).status).toBe(409);
  expect(parse).not.toHaveBeenCalled();
});

test("the person's request is sent, and the host is asked with that request's identity only", async () => {
  start(HOST);
  const fetched = host(200);
  parse.mockResolvedValue({ job: { id: "job-1" } });
  const response = await post({
    request: request({
      cookie: "pe-browser-x=token",
      origin: "http://127.0.0.1:3000",
      referer: "http://127.0.0.1:3000/doc-lab",
      [HOST_RUNTIME_SERVICE_HEADER]: "another-host",
      [HOST_CONTEXT_HEADER]: "minted",
      "x-forwarded-for": "10.0.0.1",
    }),
  });
  expect(response.status).toBe(200);
  expect(parse).toHaveBeenCalledTimes(1);
  expect(parse.mock.calls[0]![0]).toMatchObject({ sender: "person" });
  const [url, init] = fetched.mock.calls[0]!;
  expect(String(url)).toBe(`${HOST}/pe/outward/person`);
  expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
    cookie: "pe-browser-x=token",
    origin: "http://127.0.0.1:3000",
    referer: "http://127.0.0.1:3000/doc-lab",
    [HOST_RUNTIME_SERVICE_HEADER]: "svc",
    [HOST_CONTEXT_HEADER]: "minted",
  });
});
