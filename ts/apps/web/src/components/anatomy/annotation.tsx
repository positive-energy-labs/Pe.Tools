export type AnnotationVariant =
  | "frame"
  | "scroller"
  | "grid"
  | "dial"
  | "dial-strip"
  | "dial-band"
  | "dial-number"
  | "dial-preview"
  | "reticle-wick"
  | "reticle-cap"
  | "reticle-focal"
  | "caret"
  | "chat"
  | "scrim"
  | "moment"
  | "streaming-caret"
  | "tool-marker"
  | "tool-run"
  | "tool-body";

export const annotation = (variant: AnnotationVariant) => ({ "data-annotation": variant }) as const;
