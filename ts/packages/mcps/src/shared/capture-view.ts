import { createTool } from "./tool.ts";
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
      "Largest image dimension in pixels. 1500 is plenty for orientation; go higher only to read fine annotation.",
    ),
});

type RevitViewImageData = {
  view: { label?: string; elementId?: number };
  byteSize: number;
  pixelSize: number;
  viewScale?: number | null;
  modelRect?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  sheetNumber?: string | null;
};

/**
 * One-hop "let me see Revit": export a view through the host, which keeps it as a capture. The
 * tool answers small text naming the capture's URL and receipt id; pictures are for people
 * (pages ledger, 2026-10-04), and every surface links the same `/captures/<sha>.png`.
 */
export function createCaptureViewTool(createHostRpcCaller: () => Promise<HostRpcCaller>) {
  return createTool({
    id: "capture_view",
    description:
      "SEE a Revit view exactly as the user sees it — templates, VG overrides, and temporary hide/isolate all apply. Captures the active view (default), a view/sheet/viewport by id or name, or a schedule placed on a sheet, optionally cropped to elements / the selection / a scope box. Never creates or restyles views to take a picture. The host keeps the PNG as a capture; the answer names its URL (open it, or put it in a page as <img src>) and its receipt id. Use after placements/mutations so the user can check the result, or to show the user what you are looking at.",
    inputSchema: captureViewInputSchema,
    execute: async (input): Promise<{ text: string; isError?: boolean }> => {
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
      // TODO: a model that needs the pixels gets a server-side MCP image content block; the Pea MCP
      // server stringifies tool results today, so base64 here reached Claude as 763k chars of text.
      const data = result.response as RevitViewImageData;
      const extras = [
        data.sheetNumber ? `on sheet ${data.sheetNumber}` : null,
        data.viewScale ? `1:${data.viewScale}` : null,
        data.modelRect
          ? `model rect (${data.modelRect.minX.toFixed(1)},${data.modelRect.minY.toFixed(1)})→(${data.modelRect.maxX.toFixed(1)},${data.modelRect.maxY.toFixed(1)}) ft`
          : null,
      ].filter(Boolean);
      return {
        text: `${data.view?.label ?? "view"}: ${caller.hostBaseUrl.replace(/\/$/, "")}${result.capture.url} (capture ${result.capture.id}, ${data.byteSize} bytes, ${data.pixelSize}px${extras.length ? `; ${extras.join("; ")}` : ""})`,
      };
    },
  });
}
