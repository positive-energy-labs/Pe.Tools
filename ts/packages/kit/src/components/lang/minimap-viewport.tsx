import type { CSSProperties } from "react";

export function MinimapViewport({ style }: { style: CSSProperties }) {
  return <span aria-hidden data-minimap-viewport="" style={style} />;
}
