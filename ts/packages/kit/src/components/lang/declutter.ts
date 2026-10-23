export type Box = { x: number; y: number; width: number; height: number };
export const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const DIRECTIONS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
] as const;

/** Ordered boxes take a bounded free slot; null means reveal on subject hover instead.
 * The kit owns the search. Edge furniture can supply its legal edge slots. */
export function declutter<T extends Box>(
  boxes: readonly (T & { candidates?: readonly Box[] })[],
  bounds: Box,
  obstacles: readonly Box[] = [],
): (T | null)[] {
  const taken = [...obstacles];
  return boxes.map((box) => {
    const candidates =
      box.candidates ??
      [1, 2, 3].flatMap((ring) =>
        DIRECTIONS.map(([dx, dy]) => ({
          ...box,
          x: box.x + dx * ring * box.width,
          y: box.y + dy * ring * box.height,
        })),
      );
    const slot = [box, ...candidates].find(
      (b) =>
        b.x >= bounds.x &&
        b.y >= bounds.y &&
        b.x + b.width <= bounds.x + bounds.width &&
        b.y + b.height <= bounds.y + bounds.height &&
        !taken.some((t) => overlaps(b, t)),
    );
    if (!slot) return null;
    taken.push(slot);
    return { ...box, ...slot };
  });
}
