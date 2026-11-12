import { afterEach, expect, test, vi } from "vite-plus/test";
import { parseFamilyPdf } from "@pe/mcps/family-pdf";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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
  const result = await parseFamilyPdf({ sender: "person", file: new File(["%PDF-fixture"], "sheet.pdf"), apiKey: "fixture-key" });
  expect(result).toMatchObject({ jobId: "fixture", fileName: "sheet.pdf",
    pages: [{ page: 1, width: 100, height: 200, markdown: "Airflow 1200 CFM" }],
    blocks: [{ id: "p1-i0", md: "Airflow 1200 CFM" }], images: [] });
  expect(calls).toContain("https://api.cloud.llamaindex.ai/api/v2/parse/upload");
  expect(calls.some(url => url.startsWith("https://api.cloud.llamaindex.ai/api/v2/parse/fixture"))).toBe(true);
});
