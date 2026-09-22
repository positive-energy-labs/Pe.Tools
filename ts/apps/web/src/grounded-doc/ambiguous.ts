import type { GroundedBlock } from "#/grounded-doc/types";

const BBOX_MATCH_TOLERANCE = 4;

export function findAmbiguousBlockIds(blocks: readonly GroundedBlock[]): Set<string> {
  const ambiguous = new Set<string>();
  const t = BBOX_MATCH_TOLERANCE;
  // ponytail: O(blocks² · bboxes²) — blocks/page is tens, fine for a datasheet.
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocks[i].page !== blocks[j].page) continue;
      const collides = blocks[i].bboxes.some((a) =>
        blocks[j].bboxes.some(
          (b) =>
            Math.abs(a.x - b.x) < t &&
            Math.abs(a.y - b.y) < t &&
            Math.abs(a.w - b.w) < t &&
            Math.abs(a.h - b.h) < t,
        ),
      );
      if (collides) {
        ambiguous.add(blocks[i].id);
        ambiguous.add(blocks[j].id);
      }
    }
  }
  return ambiguous;
}
