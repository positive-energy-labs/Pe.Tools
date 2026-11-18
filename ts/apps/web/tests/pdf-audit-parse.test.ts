/** ADR 0052: the parser route sends directly. */
import { afterEach, expect, test, vi } from "vite-plus/test";

const parse = vi.hoisted(() => vi.fn());
// Only the parser is substituted.
vi.mock("@pe/mcps/family-pdf", () => ({ parseFamilyPdf: parse }));

import { Route } from "../src/routes/api/pdf-audit/parse";

const HOST = "http://127.0.0.1:45678";
const post = (
  Route.options as unknown as {
    server: { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } };
  }
).server.handlers.POST;
const request = (headers: Record<string, string> = {}) => {
  const form = new FormData();
  form.append("url", "https://example.test/sheet.pdf?X-Amz-Signature=secret");
  return new Request("http://127.0.0.1:3000/api/pdf-audit/parse", { method: "POST", body: form, headers });
};
/** Every fetch is a URL fetch this route made; the host is never asked. */
const host = () => {
  const fetched = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
    new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }),
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

test("a POST sends without asking the host for permission", async () => {
  start(HOST);
  const fetched = host();
  parse.mockResolvedValue({ jobId: "job-1" });
  const response = await post({ request: request() });
  expect(response.status).toBe(200);
  expect(parse).toHaveBeenCalledTimes(1);
  expect(fetched.mock.calls.map(([url]) => new URL(String(url)).host)).toEqual(["example.test"]);
  // A signed URL's query string is not part of the file's name.
  expect((parse.mock.calls[0]![0] as { file: File }).file.name).toBe("sheet.pdf");
});
