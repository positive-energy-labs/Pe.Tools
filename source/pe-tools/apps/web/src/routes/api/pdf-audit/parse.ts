import { createFileRoute } from "@tanstack/react-router";
// Side-effect type import: registers the `server` route-option augmentation.
import "@tanstack/react-start";

import type {
  DocBBox,
  DocImage,
  GroundedBlock,
  ParsedDocView,
  ParsedPage,
} from "#/grounded-doc/types";
import { putParsedDoc } from "#/grounded-doc/parse-cache";

export const Route = createFileRoute("/api/pdf-audit/parse")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LLAMA_CLOUD_API_KEY;
        if (!apiKey) {
          return Response.json(
            { error: "LLAMA_CLOUD_API_KEY is not set for the web server process." },
            { status: 501 },
          );
        }

        // Accept either an uploaded file or a public source URL (mutually exclusive).
        const form = await request.formData();
        const file = form.get("file");
        const url = form.get("url");
        const sourceUrl = typeof url === "string" && url.trim() ? url.trim() : null;
        if (!(file instanceof File) && !sourceUrl) {
          return Response.json(
            { error: "Send multipart form data with a 'file' or 'url' field." },
            { status: 400 },
          );
        }
        const fileName =
          file instanceof File
            ? file.name
            : decodeURIComponent(sourceUrl?.split("/").pop() || "document.pdf");

        // For a URL, fetch the bytes ourselves with a browser-ish User-Agent and
        // upload them, rather than handing LlamaCloud the URL. This beats sites
        // that block LlamaCloud's fetcher on User-Agent, and lets us return a
        // clear error for sites behind a JS/cookie bot-challenge (which serve an
        // HTML page instead of the PDF) rather than an opaque parse failure.
        let uploadFile: File;
        if (file instanceof File) {
          uploadFile = file;
        } else {
          const fetched = await fetchPdf(sourceUrl ?? "");
          if ("error" in fetched) {
            return Response.json({ error: fetched.error }, { status: 502 });
          }
          uploadFile = fetched.file;
        }

        // Dynamic import keeps the SDK out of the client bundle.
        const { default: LlamaCloud } = await import("@llamaindex/llama-cloud");
        const client = new LlamaCloud({ apiKey });

        // Tier is LlamaParse's "thinking level": fast < cost_effective < agentic <
        // agentic_plus. Override with PE_PDF_AUDIT_TIER; agentic_plus is the ceiling.
        const tier = process.env.PE_PDF_AUDIT_TIER ?? "agentic";
        const result = await client.parsing.parse(
          {
            tier,
            version: "latest",
            upload_file: uploadFile,
            expand: ["items", "markdown", "images_content_metadata"],
            // screenshot = full-page renders (page-lane background); embedded/layout =
            // extracted figures and layout crops shown in the images lane.
            output_options: { images_to_save: ["screenshot", "embedded", "layout"] },
          },
          { timeout: 10 * 60_000 },
        );

        if (result.job.status !== "COMPLETED") {
          return Response.json(
            { error: result.job.error_message ?? `Parse job ${result.job.status}` },
            { status: 502 },
          );
        }

        const markdownByPage = new Map<number, string>();
        for (const page of result.markdown?.pages ?? []) {
          if (page.success) markdownByPage.set(page.page_number, page.markdown);
        }

        // Screenshot filenames look like "page_1.jpg"; fall back to extraction order.
        const screenshotByPage = new Map<number, string>();
        const screenshots = (result.images_content_metadata?.images ?? []).filter(
          (image) => image.category === "screenshot" && image.presigned_url,
        );
        screenshots.forEach((image, index) => {
          const match = /(\d+)/.exec(image.filename);
          const page = match ? Number(match[1]) : index + 1;
          if (!screenshotByPage.has(page) && image.presigned_url) {
            screenshotByPage.set(page, image.presigned_url);
          }
        });

        // Extracted figures/crops for the images lane. The page number is encoded
        // in the filename ("img_p1_1.jpg", "page_2_table_1_v2.jpg").
        const images: DocImage[] = (result.images_content_metadata?.images ?? [])
          .filter(
            (image) =>
              (image.category === "embedded" || image.category === "layout") &&
              image.presigned_url &&
              image.bbox,
          )
          .map((image) => {
            const pageMatch = /(?:page[_-]|_p)(\d+)/i.exec(image.filename);
            const bbox = image.bbox as DocBBox;
            return {
              id: `img-${image.filename}`,
              page: pageMatch ? Number(pageMatch[1]) : 1,
              category: image.category as DocImage["category"],
              url: image.presigned_url as string,
              bbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
            };
          })
          .sort((a, b) => a.page - b.page || a.bbox.y - b.bbox.y);

        const pages: ParsedPage[] = [];
        const blocks: GroundedBlock[] = [];
        for (const page of result.items?.pages ?? []) {
          if (!page.success) continue;
          pages.push({
            page: page.page_number,
            width: page.page_width,
            height: page.page_height,
            screenshotUrl: screenshotByPage.get(page.page_number) ?? null,
            markdown: markdownByPage.get(page.page_number) ?? "",
          });
          page.items.forEach((item, index) => {
            const raw = item as {
              type?: string;
              md?: string;
              value?: string;
              bbox?: DocBBox[] | null;
            };
            const md = raw.md ?? raw.value ?? "";
            if (!md.trim()) return;
            blocks.push({
              id: `p${page.page_number}-i${index}`,
              page: page.page_number,
              kind: raw.type ?? "text",
              md,
              bboxes: (raw.bbox ?? []).map(({ x, y, w, h }) => ({ x, y, w, h })),
            });
          });
        }

        const view: ParsedDocView = {
          jobId: result.job.id,
          fileName,
          pages,
          blocks,
          images,
        };
        // Cache so other tabs (and pea's tools) can fetch the full grounded view by jobId.
        putParsedDoc(view);
        return Response.json(view);
      },
    },
  },
});

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

async function fetchPdf(url: string): Promise<{ file: File } | { error: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": BROWSER_UA, accept: "application/pdf,*/*" },
    });
  } catch (error) {
    return {
      error: `Couldn't reach ${url} (${error instanceof Error ? error.message : "network error"}).`,
    };
  }
  if (!response.ok) {
    return {
      error: `The source returned ${response.status} for that URL. Sites behind bot protection block automated downloads — download the PDF and upload the file instead.`,
    };
  }
  const buffer = await response.arrayBuffer();
  const header = new Uint8Array(buffer.slice(0, 5)).reduce(
    (s, b) => s + String.fromCharCode(b),
    "",
  );
  const contentType = response.headers.get("content-type") ?? "";
  if (header !== "%PDF-" && !contentType.includes("pdf")) {
    return {
      error:
        "That URL didn't return a PDF (the site likely served a bot-check page). Download the PDF and upload the file instead.",
    };
  }
  const name = decodeURIComponent(url.split("/").pop() || "document.pdf");
  return { file: new File([buffer], name, { type: "application/pdf" }) };
}
