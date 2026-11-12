import { createFileRoute } from "@tanstack/react-router";
// Side-effect type import: registers the `server` route-option augmentation.
import "@tanstack/react-start";

import { putParsedDoc } from "#/grounded-doc/parse-cache";
import { isPersonRequest } from "@pe/mcps/llama-parse";
import { parseFamilyPdf } from "@pe/mcps/family-pdf";
import { held } from "@pe/agent-contracts";

export const Route = createFileRoute("/api/pdf-audit/parse")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Guard 3 (ADR 0038): this route uploads to LlamaCloud, and can fetch a URL to do it, so
        // it runs only for the person the host proves, before the body is read.
        if (!(await isPersonRequest(request.headers)))
          return Response.json(
            {
              error: held(
                "send-outward",
                "the document",
                "Pea reads a document with read_document, which holds the send for the person's Confirm.",
              ).message,
            },
            { status: 409 },
          );
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

        let view;
        try {
          view = await parseFamilyPdf(uploadFile);
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Parse job failed" }, { status: 502 });
        }
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
