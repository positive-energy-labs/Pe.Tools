import * as fs from "node:fs/promises";
import { createTool } from "@mastra/core/tools";
import z from "zod";
import type { HostRpcCaller } from "./host-rpc-caller.ts";
import { isReadImageSuccess, type ReadImageResult } from "./read-image.ts";

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
      elementIds: z.array(z.number().int()).optional().describe("Crop to the bbox union of these elements."),
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
      "Largest image dimension in pixels. 1500 is plenty for orientation; go higher only to read fine annotation.",
    ),
  bridgeSessionId: z
    .string()
    .optional()
    .describe("Optional TS host bridge session id to target a specific connected Revit process."),
});

type RevitViewImageData = {
  view: { label?: string; elementId?: number };
  filePath: string;
  byteSize: number;
  pixelSize: number;
  viewScale?: number | null;
  modelRect?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  sheetNumber?: string | null;
};

/** One-hop "let me see Revit": export a view to PNG via the bridge, read the file, return it as an image part. */
export function createCaptureViewTool(
  createHostRpcCaller: (bridgeSessionId?: string) => HostRpcCaller,
) {
  return createTool({
    id: "capture_view",
    description:
      "SEE a Revit view exactly as the user sees it — templates, VG overrides, and temporary hide/isolate all apply. Captures the active view (default), a view/sheet/viewport by id or name, or a schedule placed on a sheet, optionally cropped to elements / the selection / a scope box. Never creates or restyles views to take a picture. Use after placements/mutations to visually verify results, or whenever you need to look at what the user is looking at.",
    inputSchema: captureViewInputSchema,
    execute: async (input): Promise<ReadImageResult> => {
      const caller = createHostRpcCaller(input.bridgeSessionId);
      const result = await caller.callOperation("revit.context.view-image", {
        target: input.target,
        focus: input.focus,
        marginPercent: input.marginPercent,
        pixelSize: input.pixelSize,
      });
      if (!result.ok) return { text: `capture_view failed: ${result.message}`, isError: true };

      const data = result.response as RevitViewImageData;
      try {
        const bytes = await fs.readFile(data.filePath);
        const extras = [
          data.sheetNumber ? `on sheet ${data.sheetNumber}` : null,
          data.viewScale ? `1:${data.viewScale}` : null,
          data.modelRect
            ? `model rect (${data.modelRect.minX.toFixed(1)},${data.modelRect.minY.toFixed(1)})→(${data.modelRect.maxX.toFixed(1)},${data.modelRect.maxY.toFixed(1)}) ft`
            : null,
        ].filter(Boolean);
        return {
          text: `${data.view?.label ?? "view"} (${data.filePath}, ${bytes.length} bytes, ${data.pixelSize}px${extras.length ? `; ${extras.join("; ")}` : ""})`,
          mediaType: "image/png",
          byteSize: bytes.length,
          data: bytes.toString("base64"),
        };
      } catch (error) {
        return {
          text: `capture_view exported to ${data.filePath} but reading it failed: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
      }
    },
    toModelOutput: (output) => {
      if (!isReadImageSuccess(output)) return undefined;
      return {
        type: "content",
        value: [
          { type: "text", text: output.text },
          { type: "media", data: output.data, mediaType: output.mediaType },
        ],
      };
    },
  });
}
