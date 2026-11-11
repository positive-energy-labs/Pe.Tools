import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { productScratchPath } from "@pe/host-contracts/service-identity";
import { runtimeRoot } from "@pe/runtime/runtime-owner";
import z from "zod";
import { LLAMA_TIER, parseWithLlamaCloud, requireLlamaCloudKey } from "./llama-parse.ts";
import { officeExtensions, readOfficeText } from "./read-office.ts";
import { createTool } from "./tool.ts";

/** Fraction of the page cut away from each side, top-left origin: LiteParse's own `cropBox`. */
const cropSchema = z
  .object({
    top: z.number().min(0).max(0.95).default(0),
    right: z.number().min(0).max(0.95).default(0),
    bottom: z.number().min(0).max(0.95).default(0),
    left: z.number().min(0).max(0.95).default(0),
  })
  .refine((c) => c.left + c.right < 0.98 && c.top + c.bottom < 0.98, "crop leaves no page");

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      "Absolute local path to a document: .pdf, an image (.png .jpg .tiff, read by OCR), .xlsx (cell grid with refs) or .docx (text, tables, review comments), read directly. Other office types are not supported. For office files pages, image and crop are ignored.",
    ),
  pages: z
    .string()
    .default("1-5")
    .describe('Pages to read, 1-based: "3", "1-5", "2,7-9". Defaults to the first five.'),
  image: z
    .boolean()
    .default(false)
    .describe(
      "Also render these pages as PNG and show them to you (at most 4). A text layer drops red strike-throughs, revision clouds, symbols, and chart lines; render to read those.",
    ),
  crop: cropSchema
    .optional()
    .describe(
      "Keep only a page region: the fraction cut away from each side, e.g. {top: 0.55, bottom: 0.2} keeps the band between 55% and 80% of the page height. Applies to the text and the render, and the render is sharper (200 dpi). Not available with parser: llamaparse.",
    ),
  parser: z
    .enum(["liteparse", "llamaparse"])
    .default("liteparse")
    .describe(
      'Text reader. "liteparse" (default) reads locally and free. "llamaparse" sends the file to LlamaCloud (needs LLAMA_CLOUD_API_KEY in the host environment, costs credits) and returns its plain text for the same pages, for A/B reads of a hard page. image still renders locally.',
    ),
});

export type ReadDocumentInput = z.input<typeof inputSchema>;

export interface ReadDocumentResult {
  text: string;
  images: Array<{ page: number; path: string; mediaType: "image/png"; data: string }>;
}

const MAX_RENDERED_PAGES = 4;
const MAX_TEXT_CHARS = 60_000;

/** The native binary loads when the module imports, so import lazily: a missing one fails this tool, not the server. */
const liteparse = import("@llamaindex/liteparse").catch((error: unknown) => {
  throw new Error(
    `read_document: the LiteParse native binary did not load on ${process.platform}-${process.arch} (${error instanceof Error ? error.message : String(error)}). Reinstall the workspace dependencies (vp i) so @llamaindex/liteparse and its platform package are present.`,
  );
});

/** Renders land beside nothing the user owns: one product scratch folder per source file and version, reused on re-read. */
async function scratchDir(file: string, mtimeMs: number): Promise<string> {
  const id = createHash("sha256").update(`${file}|${mtimeMs}`).digest("hex").slice(0, 8);
  const dir = path.join(
    productScratchPath(runtimeRoot()),
    "read-document",
    `${path.parse(file).name}-${id}`,
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function cropPng(
  png: Buffer,
  crop: { top: number; right: number; bottom: number; left: number },
): Buffer {
  const source = PNG.sync.read(png);
  const x = Math.round(source.width * crop.left);
  const y = Math.round(source.height * crop.top);
  const width = Math.max(1, Math.round(source.width * (1 - crop.left - crop.right)));
  const height = Math.max(1, Math.round(source.height * (1 - crop.top - crop.bottom)));
  const out = new PNG({ width, height });
  PNG.bitblt(source, out, x, y, width, height, 0, 0);
  return PNG.sync.write(out);
}

export async function runReadDocument(raw: ReadDocumentInput): Promise<ReadDocumentResult> {
  const input = inputSchema.parse(raw);
  const file = path.resolve(input.path);
  const stats = await fs.stat(file).catch(() => undefined);
  if (!stats?.isFile()) throw new Error(`read_document: not a file: ${file}`);

  const extension = path.extname(file).toLowerCase();
  if (officeExtensions.includes(extension)) {
    const full = readOfficeText(extension, await fs.readFile(file));
    const cut =
      full.length > MAX_TEXT_CHARS
        ? ` Text was cut at ${MAX_TEXT_CHARS} of ${full.length} characters.`
        : "";
    return {
      text: `${file}: ${extension.slice(1)} read from its XML.${cut}

${full.slice(0, MAX_TEXT_CHARS)}`,
      images: [],
    };
  }

  // Built on first use, so parser: llamaparse without a render never loads the native binary.
  const makeParser = async () => {
    const { LiteParse } = await liteparse;
    return new LiteParse({
      outputFormat: "text",
      quiet: true,
      targetPages: input.pages,
      dpi: input.crop ? 200 : 150,
      ...(input.crop ? { cropBox: input.crop } : {}),
    });
  };

  let pageTexts: Array<{ pageNum: number; text: string }>;
  let counted: string;
  if (input.parser === "llamaparse") {
    if (input.crop)
      throw new Error("read_document: crop is not available with parser: llamaparse.");
    // Refuses before any upload when the key is absent; the key itself never enters a message or log.
    let apiKey: string;
    try {
      apiKey = requireLlamaCloudKey();
    } catch (error) {
      throw new Error(`read_document: parser llamaparse refused: ${(error as Error).message}`);
    }
    const bytes = await fs.readFile(file);
    const upload = new File([new Uint8Array(bytes)], path.basename(file), {
      type: extension === ".pdf" ? "application/pdf" : "",
    });
    const result = await parseWithLlamaCloud({
      file: upload,
      apiKey,
      targetPages: input.pages,
      // Markdown, not text: agentic_plus marks a struck cell <s> in its HTML tables; its text mode drops the strike.
      expand: ["markdown"],
    }).catch((error: unknown) => {
      throw new Error(
        `read_document: LlamaParse failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    pageTexts = (result.markdown?.pages ?? []).map((page) => ({
      pageNum: page.page_number,
      text: "markdown" in page ? page.markdown : "",
    }));
    counted = `parsed by LlamaParse (${LLAMA_TIER}, markdown), read`;
  } else {
    // LiteParse's own failures (LibreOffice missing, file not a document, bad page range) already name the fix.
    const parsed = await (await makeParser()).parse(file).catch((error: unknown) => {
      throw new Error(`read_document: ${error instanceof Error ? error.message : String(error)}`);
    });
    pageTexts = parsed.pages.map((page) => ({ pageNum: page.pageNum, text: page.text }));
    counted = `${parsed.totalPages} page(s) in the document, read`;
  }

  const pages = pageTexts.map((page) => page.pageNum);
  let text = pageTexts.map((page) => `--- page ${page.pageNum} ---\n${page.text}`).join("\n\n");
  let truncated = "";
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    // Name the lost pages: a reader told only "cut" concludes a tag is absent when its page never arrived.
    const lastSeen = [...text.matchAll(/^--- page (\d+) ---$/gm)].at(-1)?.[1];
    const lost = pages.filter((p) => p >= Number(lastSeen ?? 0));
    truncated = ` Text was cut at ${MAX_TEXT_CHARS} characters: pages ${lost.join(", ")} were not fully returned, so nothing on them was searched; read them one page at a time or with a crop.`;
  }
  const header = `${file}: ${counted} ${pages.join(", ") || "none"}${input.crop ? ` cropped ${JSON.stringify(input.crop)}` : ""}.${truncated}`;

  const images: ReadDocumentResult["images"] = [];
  if (input.image) {
    const dir = await scratchDir(file, stats.mtimeMs);
    const renders = await (await makeParser()).screenshot(file, pages.slice(0, MAX_RENDERED_PAGES));
    for (const render of renders) {
      const png = input.crop ? cropPng(render.imageBuffer, input.crop) : render.imageBuffer;
      // A crop is part of the name so a second crop never overwrites the first render a result named.
      const cropId = input.crop
        ? `-crop-${createHash("sha256").update(JSON.stringify(input.crop)).digest("hex").slice(0, 6)}`
        : "";
      const out = path.join(dir, `page-${render.pageNum}${cropId}.png`);
      await fs.writeFile(out, png);
      images.push({
        page: render.pageNum,
        path: out,
        mediaType: "image/png",
        data: png.toString("base64"),
      });
    }
  }
  const note = images.length
    ? `\nRendered pages (also on disk): ${images.map((i) => i.path).join(", ")}${pages.length > images.length ? ` Only the first ${MAX_RENDERED_PAGES} pages were rendered.` : ""}`
    : "";
  return { text: `${header}\n\n${text}${note}`, images };
}

export const readDocument = createTool({
  id: "read_document",
  description: [
    "Read a project document on disk (PDF spec sheet, schedule, submittal, drawing set; images by OCR; .xlsx and .docx directly, including docx review comments). Local and read-only; the file is never modified and renders go to a product scratch folder named in the result.",
    "Method: take the text first to LOCATE the value (spatial text keeps table columns aligned), then pass image: true with the same pages, and crop when you only need one schedule or chart, to READ it. The text layer loses red strike-throughs, revision clouds, symbols and chart lines, so a number read from text alone is not verified until you have seen the page.",
    "parser: llamaparse reads the same pages with LlamaCloud instead of locally (key in the host environment, costs credits); use it to A/B a page the local text garbled, not by default.",
    "Not for Revit model facts; use pe_find for those.",
  ].join("\n"),
  inputSchema,
  execute: runReadDocument,
  toModelOutput: (output) => {
    const result = output as ReadDocumentResult;
    return {
      type: "content",
      value: [
        { type: "text", text: result.text },
        ...result.images.map((image) => ({
          type: "media",
          data: image.data,
          mediaType: image.mediaType,
        })),
      ],
    };
  },
});
