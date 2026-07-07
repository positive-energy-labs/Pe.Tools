import * as fs from "node:fs/promises";
import { createTool } from "@mastra/core/tools";
import z from "zod";
import type { HostRpcCaller } from "./host-rpc-caller.ts";
import { isReadImageSuccess, type ReadImageResult } from "./read-image.ts";

const captureViewInputSchema = z.object({
  viewId: z
    .number()
    .int()
    .optional()
    .describe(
      "Revit view or sheet element id to capture. Omit to capture the active view the user is looking at.",
    ),
  viewUniqueId: z
    .string()
    .optional()
    .describe("Revit view/sheet unique id, when a prior operation returned unique ids."),
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
};

/** One-hop "let me see Revit": export a view to PNG via the bridge, read the file, return it as an image part. */
export function createCaptureViewTool(
  createHostRpcCaller: (bridgeSessionId?: string) => HostRpcCaller,
) {
  return createTool({
    id: "capture_view",
    description:
      "SEE the current Revit view (or an explicit view/sheet by id) as an image in one step. Exports the view to PNG through the connected Revit session and returns the image directly. Use after placements/mutations to visually verify results, or whenever you need to look at what the user is looking at.",
    inputSchema: captureViewInputSchema,
    execute: async (input): Promise<ReadImageResult> => {
      const caller = createHostRpcCaller(input.bridgeSessionId);
      const result = await caller.callOperation("revit.context.view-image", {
        viewId: input.viewId,
        viewUniqueId: input.viewUniqueId,
        pixelSize: input.pixelSize,
      });
      if (!result.ok) return { text: `capture_view failed: ${result.message}`, isError: true };

      const data = result.response as RevitViewImageData;
      try {
        const bytes = await fs.readFile(data.filePath);
        return {
          text: `${data.view?.label ?? "view"} (${data.filePath}, ${bytes.length} bytes, ${data.pixelSize}px)`,
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
