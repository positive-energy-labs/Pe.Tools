import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createTool } from "@mastra/core/tools";
import z from "zod";
import { resolveWorkspacePathAccess } from "./request-access.ts";

const imageMediaTypesByExtension: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export const defaultReadImageMaxBytes = 5 * 1024 * 1024;

const readImageInputSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .describe(
      "Absolute or workspace-relative path to a .png, .jpg/.jpeg, .webp, or .gif image file.",
    ),
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024)
    .default(defaultReadImageMaxBytes)
    .describe("Refuse files larger than this many bytes. Defaults to 5MB."),
});

export interface ReadImageSuccess {
  text: string;
  mediaType: string;
  byteSize: number;
  /** Base64-encoded image bytes; surfaced to the model as an image part via toModelOutput. */
  data: string;
}

export interface ReadImageFailure {
  text: string;
  isError: true;
}

export type ReadImageResult = ReadImageSuccess | ReadImageFailure;

export function isReadImageSuccess(value: unknown): value is ReadImageSuccess {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.isError !== true &&
    typeof record.text === "string" &&
    typeof record.data === "string" &&
    typeof record.mediaType === "string"
  );
}

export const readImage = createTool({
  id: "read_image",
  description:
    "View an image file from disk (png/jpeg/webp/gif) so you can actually SEE it. Use when you need to look at exported Revit view images, plan/sheet PNGs, or other visual artifacts referenced by path.",
  inputSchema: readImageInputSchema,
  execute: async (input, context): Promise<ReadImageResult> => {
    const access = resolveWorkspacePathAccess(input.filePath, context);
    const mediaType = imageMediaTypesByExtension[path.extname(access.absolutePath).toLowerCase()];
    if (!mediaType) {
      return readImageFailure(
        `Unsupported image extension for "${access.absolutePath}". Supported: .png, .jpg, .jpeg, .webp, .gif.`,
      );
    }
    if (!access.allowed) {
      return readImageFailure(
        `Access denied: "${access.absolutePath}" is outside the Pea workspace and allowed paths. Use request_access to gain access first.`,
      );
    }

    let byteSize: number;
    try {
      const stats = await fs.stat(access.absolutePath);
      if (!stats.isFile()) return readImageFailure(`Not a file: "${access.absolutePath}".`);
      byteSize = stats.size;
    } catch {
      return readImageFailure(`Image not found: "${access.absolutePath}".`);
    }

    const maxBytes = input.maxBytes ?? defaultReadImageMaxBytes;
    if (byteSize > maxBytes) {
      return readImageFailure(
        `Image is ${byteSize} bytes, over the ${maxBytes}-byte limit. Pass a larger maxBytes if you really need it.`,
      );
    }

    const bytes = await fs.readFile(access.absolutePath);
    return {
      text: `${access.absolutePath} (${byteSize} bytes, ${mediaType})`,
      mediaType,
      byteSize,
      data: bytes.toString("base64"),
    };
  },
  // Modern mastra path: the agent loop stores this under providerMetadata.mastra.modelOutput and
  // the v5 llmPrompt substitutes it as the tool-result output, so the model receives the image
  // as a media part (translated to image-data for AI SDK v6 providers).
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

function readImageFailure(text: string): ReadImageFailure {
  return { text, isError: true };
}
