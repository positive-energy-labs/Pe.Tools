import type {
  DocBBox,
  DocImage,
  GroundedBlock,
  ParsedDocView,
  ParsedPage,
} from "@pe/agent-contracts";
import { parseWithLlamaCloud, type LlamaParseRequest } from "./llama-parse.ts";

export type FamilyPdfRequest = Pick<
  LlamaParseRequest,
  "sender" | "file" | "apiKey"
>;

/** Parse directly; the shared upload path records the send notice (ADR 0052). */
export async function parseFamilyPdf(request: FamilyPdfRequest): Promise<ParsedDocView> {
  const { file } = request;
  const result = await parseWithLlamaCloud({
    ...request,
    expand: ["items", "markdown", "images_content_metadata"],
    imagesToSave: ["screenshot", "embedded", "layout"],
  });
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

  return {
    jobId: result.job.id,
    fileName: file.name,
    pages,
    blocks,
    images,
  };
}
