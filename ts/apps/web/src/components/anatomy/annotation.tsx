export type AnnotationVariant =
  | "frame"
  | "scroller"
  | "grid"
  | "lane"
  | "dial"
  | "dial-band"
  | "dial-tick"
  | "thumb"
  | "peek"
  | "peek-column"
  | "peek-funnel"
  | "peek-card"
  | "peek-head"
  | "peek-ask"
  | "peek-answer"
  | "chat"
  | "moment"
  | "streaming-caret"
  | "tool-marker"
  | "tool-run"
  | "tool-body";

export const annotation = (variant: AnnotationVariant) => ({ "data-annotation": variant }) as const;
