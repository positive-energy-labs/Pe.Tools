import { afterEach, expect, test, vi } from "vite-plus/test";
import { parseFamilyPdf } from "@pe/mcps/family-pdf";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("a failed upload surfaces after one attempt per person send", async () => {
  const uploads: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.endsWith("/api/v2/parse/upload")) throw Error("Unexpected polling after failed upload");
    uploads.push(url);
    // A service that quotes the credential it refused.
    return Response.json({ detail: "Upload failed for key fixture-key" }, { status: 500 });
  }));
  const sent = vi.fn();
  const failure = await parseFamilyPdf({ file: new File(["%PDF-fixture"], "sheet.pdf"), apiKey: "fixture-key", sent })
    .catch((error: Error) => error.message);
  expect(failure).toMatch(/500/);
  // Mutant: drop the `replaceAll` in `parseWithLlamaCloud`; the key then reaches Pea's tool result.
  expect(failure).not.toContain("fixture-key");
  expect(failure).toContain("[key]");
  expect(uploads).toHaveLength(1);
  // Nothing was accepted, so nothing is noticed as sent.
  expect(sent).not.toHaveBeenCalled();
});

// Mutant: restore the old adapter's no-webUrl refusal. Only the remote HTTP boundary is substituted.
test("parseFamilyPdf uses the explicit key in-process without a webUrl or environment key", async () => {
  vi.stubEnv("LLAMA_CLOUD_API_KEY", "");
  vi.stubEnv("LLAMA_CLOUD_BASE_URL", "https://api.cloud.llamaindex.ai");
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.includes("/api/pdf-audit")) throw Error("No web server");
    return Response.json({ id: "fixture", status: "COMPLETED",
      job: { id: "fixture", status: "COMPLETED" },
      items: { pages: [{ success: true, page_number: 1, page_width: 100, page_height: 200,
        items: [{ type: "text", md: "Airflow 1200 CFM", bbox: [] }] }] },
      markdown: { pages: [{ success: true, page_number: 1, markdown: "Airflow 1200 CFM" }] },
      images_content_metadata: { images: [] },
    });
  }));
  const sent = vi.fn();
  const result = await parseFamilyPdf({ file: new File(["%PDF-fixture"], "sheet.pdf"), apiKey: "fixture-key", sent });
  expect(sent.mock.calls).toEqual([[{ jobId: "fixture", fileName: "sheet.pdf", pages: "all pages" }]]);
  expect(result).toMatchObject({ jobId: "fixture", fileName: "sheet.pdf",
    pages: [{ page: 1, width: 100, height: 200, markdown: "Airflow 1200 CFM" }],
    blocks: [{ id: "p1-i0", md: "Airflow 1200 CFM" }], images: [] });
  expect(calls).toContain("https://api.cloud.llamaindex.ai/api/v2/parse/upload");
  expect(calls.some(url => url.startsWith("https://api.cloud.llamaindex.ai/api/v2/parse/fixture"))).toBe(true);
});
