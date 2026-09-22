import type { Path } from "./path.ts";

export function dataAt(path: Path, data: unknown): unknown {
  let cursor: unknown = data;

  if (cursor === undefined || cursor === null) {
    return undefined;
  }

  for (const key of path) {
    if (cursor === undefined || cursor === null || typeof cursor !== "object") {
      return undefined;
    }

    if (Array.isArray(cursor) && typeof key === "number") {
      cursor = cursor[key];
      continue;
    }

    cursor = (cursor as Record<string, unknown>)[String(key)];
  }

  return cursor;
}
