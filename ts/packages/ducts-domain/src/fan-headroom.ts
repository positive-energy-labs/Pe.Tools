/**
 * A fan's load against its own limit: the external static the system needs (Pe's priced fan static)
 * over the external static the unit is rated for (its `externalStatic` fact, read through the
 * `fanStatic` parameter slot). A unit with no rating is unknown, never a full or an empty bar.
 */
export type FanLoad =
  | { state: "unrated"; required: number | null }
  | { state: "rated"; required: number; available: number; ratio: number; over: boolean };

/** Required over available; unrated when either is missing or the rating is not positive. */
export function fanLoad(required: number | null, available: number | null): FanLoad {
  if (required == null || available == null || !(available > 0))
    return { state: "unrated", required };
  const ratio = required / available;
  return { state: "rated", required, available, ratio, over: ratio > 1 };
}
