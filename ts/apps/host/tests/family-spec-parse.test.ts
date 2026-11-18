// @vitest-environment node
/*
 * The page's upload surface on the host (`POST /pe/family-spec/parse`; homes ledger 2026-11-17, ADR 0052)
 * over the whole host and real HTTP, so the route's admission is the host's own. Substituted: the
 * network past the host (LlamaCloud's upload and poll routes, its render URL, one vendor URL).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import { notices } from "@pe/host-contracts/kinds";
import { parsedDocViewSchema } from "@pe/agent-contracts";
import { mintBrowserContext, mintContext } from "../src/control.ts";
import { hostState } from "../src/host-ownership.ts";
import { serviceHeaders } from "./callers.ts";
import { bootHost } from "./real-server.ts";

vi.mock("../src/pe-revit-launch.ts", async (original) => ({
  ...(await original<typeof import("../src/pe-revit-launch.ts")>()),
  peRevitLauncher: () => ({ cmd: process.execPath, args: [] }),
}));

const pdf = readFileSync(fileURLToPath(new URL("../../web/public/acme-fcu400-submittal.pdf", import.meta.url)));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSacAAAAASUVORK5CYII=", "base64");
const KEY = "llx-fixture-key-never-shown";
const SIGNATURE = "secret-signature";
const RENDER = `https://renders.example/page_1.jpg?X-Amz-Signature=${SIGNATURE}`;
const VENDOR = `https://93.184.216.34/sheets/vendor-sheet.pdf?X-Amz-Signature=${SIGNATURE}`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("the upload surface's parse is the person's door: it sends once, keeps the parse, and leaves one notice", async () => {
  vi.stubEnv("LLAMA_CLOUD_API_KEY", KEY);
  const real = globalThis.fetch;
  const uploads: number[] = [];
  let failUpload = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === RENDER) return new Response(png, { headers: { "content-type": "image/png" } });
    if (url.href === VENDOR) return new Response(Buffer.concat([pdf, Buffer.from("\n% vendor\n")]), { headers: { "content-type": "application/pdf" } });
    if (!url.host.endsWith("llamaindex.ai")) return real(input, init);
    if (url.pathname.endsWith("/parse/upload")) {
      uploads.push(uploads.length + 1);
      // A service that quotes the credential it refused.
      if (failUpload) return Response.json({ detail: `Invalid API key ${KEY}` }, { status: 401 });
    }
    const id = `job-parse-door-${uploads.length}`;
    return Response.json({ id, status: "COMPLETED", job: { id, status: "COMPLETED" },
      items: { pages: [{ success: true, page_number: 1, page_width: 100, page_height: 200, items: [{ type: "text", md: "Airflow 1200 CFM", bbox: [] }] }] },
      markdown: { pages: [{ success: true, page_number: 1, markdown: "Airflow 1200 CFM" }] },
      images_content_metadata: { images: [{ category: "screenshot", filename: "page_1.jpg", presigned_url: RENDER }] },
    });
  });
  const host = await bootHost();
  try {
    const person = {
      cookie: mintBrowserContext({ kind: "local" }).split(";")[0]!,
      ...serviceHeaders(),
      origin: host.base,
      "sec-fetch-site": "same-origin",
      referer: `${host.base}/family`,
    };
    const post = async (path: string, headers: Record<string, string>, body: unknown) => {
      const response = await real(`${host.base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      return { status: response.status, text: await response.text() };
    };
    const parse = (headers: Record<string, string>, body: unknown) => post("/pe/family-spec/parse", headers, body);
    const sent = () => notices(hostState()).filter((row) => row.class === "sent");

    // Admission is the host's own: no context, Pea, an outside MCP caller and another site are all refused
    // before anything is read or sent. Mutant: declare the route "read"; the first line turns red.
    expect((await parse({}, { url: VENDOR })).text).toContain("context.missing");
    for (const headers of [
      { [HOST_CONTEXT_HEADER]: mintContext({ kind: "pea", thread: "t-parse" }) },
      { [HOST_CONTEXT_HEADER]: mintContext({ kind: "external-mcp", label: "ext" }) },
    ]) {
      const refused = await parse(headers, { url: VENDOR });
      expect([refused.status, refused.text]).toEqual([403, expect.stringContaining("human.only")]);
    }
    const crossSite = await parse({ ...person, origin: "https://other.example", "sec-fetch-site": "cross-site", referer: "https://other.example/" }, { url: VENDOR });
    expect(crossSite.status).toBeGreaterThanOrEqual(400);
    expect([uploads.length, sent().length]).toEqual([0, 0]);

    // The person uploads a file: one send, the grounded view with its render inline, one notice.
    const blob = JSON.parse((await post("/actions/blobs", person, { fileName: "acme sheet.pdf", base64: pdf.toString("base64") })).text);
    const first = await parse(person, blob);
    expect(first.status, first.text.slice(0, 500)).toBe(200);
    const view = parsedDocViewSchema.parse(JSON.parse(first.text));
    expect(view).toMatchObject({ fileName: "acme sheet.pdf", blocks: [{ md: "Airflow 1200 CFM" }] });
    expect(view.pages[0]!.screenshotUrl).toBe(`data:image/png;base64,${png.toString("base64")}`);
    expect(uploads).toHaveLength(1);
    expect(sent()).toMatchObject([{ place: "LlamaCloud", path: "acme sheet.pdf", reason: "Sent acme sheet.pdf to LlamaCloud (all pages)." }]);
    // The same bytes again are found kept: nothing is sent and no second notice is written.
    expect((await parse(person, blob)).status).toBe(200);
    expect([uploads.length, sent().length]).toEqual([1, 1]);

    // A URL on this machine or its network is refused before any fetch, and its query is not repeated.
    for (const local of ["http://127.0.0.1:9/a.pdf", "http://localhost:9/a.pdf", "http://[::1]:9/a.pdf", "http://[::ffff:127.0.0.1]:9/a.pdf", "http://10.1.2.3/a.pdf", "http://192.168.1.10/a.pdf", "http://169.254.169.254/latest/meta-data"]) {
      const refused = await parse(person, { url: `${local}?sig=${SIGNATURE}` });
      expect([refused.status, refused.text], local).toEqual([400, expect.stringContaining("on this machine or its network")]);
      expect(refused.text).not.toContain(SIGNATURE);
    }
    expect((await parse(person, { path: "C:/Windows/win.ini" })).status).toBe(400);
    // A public URL is fetched by the host and named by its pathname only.
    const byUrl = await parse(person, { url: VENDOR });
    expect(byUrl.status, byUrl.text.slice(0, 500)).toBe(200);
    expect(JSON.parse(byUrl.text).fileName).toBe("vendor-sheet.pdf");
    expect(sent().map((row) => row.path)).toEqual(["acme sheet.pdf", "vendor-sheet.pdf"]);

    // A parser failure that quotes the key answers without it, and leaves no notice.
    failUpload = true;
    const other = JSON.parse((await post("/actions/blobs", person, { fileName: "other.pdf", base64: Buffer.concat([pdf, Buffer.from("\n% other\n")]).toString("base64") })).text);
    const failed = await parse(person, other);
    expect([failed.status, failed.text]).toEqual([502, expect.stringContaining("401")]);
    expect(sent()).toHaveLength(2);
    // Neither the key nor a signed URL reached an answer or a stored notice.
    for (const text of [first.text, byUrl.text, failed.text, JSON.stringify(notices(hostState()))]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(SIGNATURE);
    }
  } finally {
    await host.close();
  }
}, 120_000);
