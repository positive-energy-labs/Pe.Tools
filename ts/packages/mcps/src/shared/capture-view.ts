import { createTool } from "./tool.ts";
import { createHash } from "node:crypto";
import { contextFetch as fetch } from "@pe/runtime/context";
import { defaultReadImageMaxBytes, readImage, type ReadImageResult } from "./read-image.ts";
import z from "zod";
import type { HostRpcCaller } from "./host-rpc-caller.ts";

const captureViewInputSchema = z.object({
  target: z
    .object({
      id: z
        .number()
        .int()
        .optional()
        .describe("Element id of a view, sheet, viewport (derefs to its view), or schedule."),
      uniqueId: z.string().optional().describe("Unique id, when a prior operation returned one."),
      name: z
        .string()
        .optional()
        .describe(
          "View name, sheet name, sheet number ('A101'), or schedule name. Exact match first, then unique substring.",
        ),
      onSheet: z
        .string()
        .optional()
        .describe(
          "Sheet number or name: disambiguates a name placed on multiple sheets, and picks which placement of a schedule to capture.",
        ),
    })
    .optional()
    .describe(
      "What to capture. Omit to capture the active view the user is looking at. Schedules capture only as placed on a sheet; unplaced schedules error — read those as data instead.",
    ),
  focus: z
    .object({
      elementIds: z
        .array(z.number().int())
        .optional()
        .describe("Crop to the bbox union of these elements."),
      selection: z.boolean().optional().describe("Crop to the user's current selection."),
      scopeBox: z.string().optional().describe("Crop to this scope box (name or element id)."),
    })
    .optional()
    .describe(
      "Optional crop — exactly one of elementIds, selection, or scopeBox. Uses a temporary crop box that is rolled back, so graphics stay exactly what the user sees. Needs an editable document; not supported on sheets.",
    ),
  marginPercent: z
    .number()
    .min(0)
    .max(100)
    .default(8)
    .describe("Breathing room around the focus/schedule crop, as % of its larger dimension."),
  pixelSize: z
    .number()
    .int()
    .min(100)
    .max(8000)
    .default(1500)
    .describe(
      "Asked long side of the image (of the crop, when focused or cropped), in pixels. 1500 is plenty for orientation; go higher only to read fine annotation. Revit exports a cropped view's whole extent, capped at 8000 px, so a crop that is a small part of an unfocused view can come back smaller; the answer reports the delivered size and warns when it is a thumbnail.",
    ),
});

type RevitViewImageData = {
  view: { label?: string; elementId?: number };
  byteSize: number;
  width: number;
  height: number;
  warning?: string | null;
  viewScale?: number | null;
  modelRect?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  sheetNumber?: string | null;
};

/**
 * One-hop "let me see Revit": export a view through the host, which keeps it as a capture. The
 * tool delivers the kept PNG as MCP image content beside its URL and receipt id. Every surface
 * links the same `/captures/<sha>.png`; only that returned capture is fetched from the bound host.
 */
export function createCaptureViewTool(createHostRpcCaller: () => Promise<HostRpcCaller>) {
  return createTool({
    id: "capture_view",
    description:
      "SEE a Revit view exactly as the user sees it — templates, VG overrides, and temporary hide/isolate all apply. Captures the active view (default), a view/sheet/viewport by id or name, or a schedule placed on a sheet, optionally cropped to elements / the selection / a scope box. Never creates or restyles views to take a picture. The answer includes the kept PNG as an image, its URL (open it, or put it in a page as <img src>), and its receipt id. Images over 5MB require a smaller pixelSize. Use after placements/mutations so the user can check the result, or to show the user what you are looking at.",
    inputSchema: captureViewInputSchema,
    execute: async (input): Promise<ReadImageResult> => {
      const caller = await createHostRpcCaller();
      const result = await caller.callOperation("revit.context.view-image", {
        target: input.target,
        focus: input.focus,
        marginPercent: input.marginPercent,
        pixelSize: input.pixelSize,
      });
      if (!result.ok) return { text: `capture_view failed: ${result.message}`, isError: true };
      if (!result.capture)
        return { text: "capture_view: the host answered without keeping a capture", isError: true };
      const data = result.response as RevitViewImageData;
      const extras = [
        data.sheetNumber ? `on sheet ${data.sheetNumber}` : null,
        data.viewScale ? `1:${data.viewScale}` : null,
        data.modelRect
          ? `model rect (${data.modelRect.minX.toFixed(1)},${data.modelRect.minY.toFixed(1)})→(${data.modelRect.maxX.toFixed(1)},${data.modelRect.maxY.toFixed(1)}) ft`
          : null,
      ].filter(Boolean);
      const text = `${data.view?.label ?? "view"}: ${caller.hostBaseUrl.replace(/\/$/, "")}${result.capture.url} (capture ${result.capture.id}, ${data.byteSize} bytes, ${data.width}x${data.height}px delivered${extras.length ? `; ${extras.join("; ")}` : ""})${
        data.warning
          ? `
Warning: ${data.warning}`
          : ""
      }`;
      try {
        const sha = /^\/captures\/([0-9a-f]{64})\.png$/.exec(result.capture.url)?.[1];
        if (!sha) throw new Error("The host returned an invalid capture URL");
        if (data.byteSize > defaultReadImageMaxBytes)
          throw new Error("Image exceeds the 5MB limit; capture again with a smaller pixelSize");
        const response = await fetch(
          `${caller.hostBaseUrl.replace(/\/$/, "")}${result.capture.url}`,
          {
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/png")
          throw new Error(`Capture PNG was not available (${response.status})`);
        if (!response.body) throw new Error("Capture PNG had no body");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let byteSize = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            byteSize += chunk.value.byteLength;
            if (byteSize > defaultReadImageMaxBytes)
              throw new Error(
                "Image exceeds the 5MB limit; capture again with a smaller pixelSize",
              );
            chunks.push(chunk.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        const bytes = Buffer.concat(chunks);
        if (createHash("sha256").update(bytes).digest("hex") !== sha)
          throw new Error("Capture PNG did not match its content hash");
        return { text, mediaType: "image/png", byteSize, data: bytes.toString("base64") };
      } catch (error) {
        return {
          text: `${text}\nImage not delivered: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
      }
    },
    toModelOutput: readImage.toModelOutput,
  });
}
