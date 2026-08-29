export interface DocBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GroundedBlock {
  id: string;
  page: number;
  kind: string;
  md: string;
  bboxes: DocBBox[];
}

export interface ParsedPage {
  page: number;
  width: number;
  height: number;
  screenshotUrl: string | null;
  markdown: string;
}

export interface DocImage {
  id: string;
  page: number;
  category: "embedded" | "layout";
  url: string;
  bbox: DocBBox;
}

export interface ParsedDocView {
  jobId: string;
  fileName: string;
  pages: ParsedPage[];
  blocks: GroundedBlock[];
  images: DocImage[];
}
