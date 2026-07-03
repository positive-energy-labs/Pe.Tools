/**
 * Grounded-document primitives: a parsed document is pages (with optional
 * screenshots) plus ordered blocks, each carrying its markdown and its page
 * bounding boxes. The block is the identity unit — anything that references a
 * block id can be grounded back to both the prose and the pixels.
 */

export interface DocBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GroundedBlock {
  id: string;
  /** 1-based page number */
  page: number;
  kind: string;
  md: string;
  /** Page-point coordinates (page width/height on ParsedPage) */
  bboxes: DocBBox[];
}

export interface ParsedPage {
  page: number;
  width: number;
  height: number;
  screenshotUrl: string | null;
  markdown: string;
}

/**
 * An image the parser extracted from the document — an embedded figure or a
 * layout-detected crop (a diagram/table region). Kept separate from blocks and
 * shown in its own lane so images aren't inlined into the markdown.
 */
export interface DocImage {
  id: string;
  /** 1-based page number */
  page: number;
  category: "embedded" | "layout";
  url: string;
  /** Page-point coordinates (same space as the block bboxes / ParsedPage). */
  bbox: DocBBox;
}

export interface ParsedDocView {
  jobId: string;
  fileName: string;
  pages: ParsedPage[];
  blocks: GroundedBlock[];
  images: DocImage[];
}
