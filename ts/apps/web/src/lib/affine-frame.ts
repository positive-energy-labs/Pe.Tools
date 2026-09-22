/**
 * Renderer-neutral content-to-viewport geometry. Domain projections stay with their feature;
 * this module owns only finite bounds, uniform fitting, axis orientation, and exact inversion.
 */
export type Point2 = readonly [x: number, y: number];

export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Viewport2 {
  width: number;
  height: number;
}

export interface AffineFrame {
  scale: number;
  /** Valid for both SVG's transform attribute and CSS transform. */
  transform: string;
  toViewport: (point: Point2) => Point2;
  toContent: (point: Point2) => Point2;
}

export function boundsOf(points: Iterable<Point2>): Bounds2 {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const bounds = { minX, minY, maxX, maxY };
  assertBounds(bounds);
  return bounds;
}

export function unionBounds(first: Bounds2, ...rest: readonly Bounds2[]): Bounds2 {
  assertBounds(first);
  return rest.reduce((union, bounds) => {
    assertBounds(bounds);
    return {
      minX: Math.min(union.minX, bounds.minX),
      minY: Math.min(union.minY, bounds.minY),
      maxX: Math.max(union.maxX, bounds.maxX),
      maxY: Math.max(union.maxY, bounds.maxY),
    };
  }, first);
}

/**
 * The common SVG prelude: a viewport sized to the content itself plus proportional padding.
 *
 *   const { viewport, padding } = contentViewport(bounds, 0.03);
 *   const frame = fitFrame(bounds, viewport, { padding, yAxis: "up" });
 *
 * resolves to scale 1, so the frame is a pure Y-flip + pad. Use when the SVG scales itself via
 * viewBox rather than living in a measured pixel box.
 */
export function contentViewport(
  content: Bounds2,
  padRatio = 0.03,
): { viewport: Viewport2; padding: number } {
  assertBounds(content);
  if (!Number.isFinite(padRatio) || padRatio < 0)
    throw new Error(`contentViewport requires a finite, non-negative padRatio; got ${padRatio}.`);
  const width = Math.max(content.maxX - content.minX, Number.EPSILON);
  const height = Math.max(content.maxY - content.minY, Number.EPSILON);
  const padding = Math.max(width, height) * padRatio;
  return { viewport: { width: width + padding * 2, height: height + padding * 2 }, padding };
}

export function fitFrame(
  content: Bounds2,
  viewport: Viewport2,
  options: {
    align?: Point2;
    padding?: number;
    yAxis?: "down" | "up";
    maxScale?: number;
  } = {},
): AffineFrame {
  assertBounds(content);
  // Exact and fail-fast on purpose: a silent padding clamp would break contentViewport's
  // scale-1 guarantee invisibly (consumers keep stroke widths and type in content units).
  // Degradation policy for measured, resizable viewports belongs at the caller — clamp YOUR
  // padding to what YOUR pane affords before calling.
  const { align = [0.5, 0.5], padding = 0, yAxis = "down", maxScale = Infinity } = options;
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    !Number.isFinite(padding) ||
    padding < 0 ||
    padding * 2 >= viewport.width ||
    padding * 2 >= viewport.height ||
    (!Number.isFinite(maxScale) && maxScale !== Infinity) ||
    maxScale <= 0 ||
    align.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
  )
    throw new Error(
      `Affine frame requires a positive viewport, affordable padding, maxScale, and alignment; ` +
        `got viewport ${viewport.width}×${viewport.height}, padding ${options.padding ?? 0}, ` +
        `maxScale ${maxScale}, align [${align.join(",")}].`,
    );

  const contentWidth = Math.max(content.maxX - content.minX, Number.EPSILON);
  const contentHeight = Math.max(content.maxY - content.minY, Number.EPSILON);
  const scale = Math.min(
    (viewport.width - padding * 2) / contentWidth,
    (viewport.height - padding * 2) / contentHeight,
    maxScale,
  );
  const sx = scale;
  const sy = yAxis === "up" ? -scale : scale;
  const renderedWidth = contentWidth * scale;
  const renderedHeight = contentHeight * scale;
  const transformedMinX = content.minX * sx;
  const transformedMinY = Math.min(content.minY * sy, content.maxY * sy);
  const tx = padding + (viewport.width - padding * 2 - renderedWidth) * align[0] - transformedMinX;
  const ty =
    padding + (viewport.height - padding * 2 - renderedHeight) * align[1] - transformedMinY;
  const toViewport = ([x, y]: Point2): Point2 => [tx + x * sx, ty + y * sy];
  const toContent = ([x, y]: Point2): Point2 => [(x - tx) / sx, (y - ty) / sy];

  return {
    scale,
    transform: `matrix(${sx},0,0,${sy},${tx},${ty})`,
    toViewport,
    toContent,
  };
}

function assertBounds(bounds: Bounds2): void {
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxY) ||
    bounds.maxX < bounds.minX ||
    bounds.maxY < bounds.minY
  )
    throw new Error("Affine frame requires finite, ordered content bounds.");
}
