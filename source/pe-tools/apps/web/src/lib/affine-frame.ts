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
 * The common SVG prelude: a viewport sized to the content itself plus proportional padding, so
 * `fitFrame(bounds, contentViewport(bounds, ratio), { padding })` resolves to scale 1 and the
 * frame is a pure Y-flip + pad. Use when the SVG scales itself via viewBox rather than living in
 * a measured pixel box.
 */
export function contentViewport(
  content: Bounds2,
  padRatio = 0.03,
): { viewport: Viewport2; padding: number } {
  assertBounds(content);
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
  const { align = [0.5, 0.5], yAxis = "down", maxScale = Infinity } = options;
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    !Number.isFinite(options.padding ?? 0) ||
    (options.padding ?? 0) < 0 ||
    (!Number.isFinite(maxScale) && maxScale !== Infinity) ||
    maxScale <= 0 ||
    align.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
  )
    throw new Error(
      "Affine frame requires a positive viewport, finite padding, maxScale, and alignment.",
    );
  // A padding the viewport cannot afford CLAMPS instead of throwing: viewports here are often
  // measured pixels from resizable panes, and a mid-drag sliver must degrade, never crash.
  const padding = Math.min(
    options.padding ?? 0,
    (Math.min(viewport.width, viewport.height) / 2) * 0.9,
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
