import { z } from "zod";
import type { Codec } from "./page-keys.ts";

/** Literal keywords and explicitly chosen equalities. Unknown versions/operators remain visible
 * so a restored address can refuse the search instead of silently broadening its results. */
export const listSearchSchema = z.object({
  v: z.number().int(),
  keywords: z.string().max(4000),
  pills: z.array(z.object({ field: z.string(), op: z.string(), value: z.string() })).max(32),
});
export type ListSearch = z.infer<typeof listSearchSchema>;
export type ListPill = ListSearch["pills"][number];
export const emptyListSearch = (): ListSearch => ({ v: 1, keywords: "", pills: [] });
export const listSearchKey = () => listSearchSchema.default(emptyListSearch);
export const listSearchCodec: Codec<ListSearch> = {
  encode: (search) => JSON.stringify(search),
  decode: (text) => {
    try {
      const parsed = listSearchSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    } catch {
      /* Keep a malformed address inspectable and resettable. */
    }
    return { v: 0, keywords: text.slice(0, 4000), pills: [] };
  },
};

export function listSearchRefusal(search: ListSearch, fields: readonly string[]): string | null {
  if (search.v !== 1) return `Unsupported search version ${search.v}. Clear search to reset.`;
  const seen = new Set<string>();
  for (const pill of search.pills) {
    if (!fields.includes(pill.field))
      return `Unknown filter: ${pill.field}. Remove it or clear search.`;
    if (pill.op !== "=")
      return `Unsupported filter operator: ${pill.op}. Remove it or clear search.`;
    if (seen.has(pill.field)) return `Repeated filter: ${pill.field}. Remove it or clear search.`;
    seen.add(pill.field);
  }
  return null;
}

/** Replacement preserves pill order; new fields append. */
export function pickListPill(search: ListSearch, field: string, value: string): ListSearch {
  const pill = { field, op: "=", value };
  return {
    ...search,
    pills: search.pills.some((each) => each.field === field)
      ? search.pills.map((each) => (each.field === field ? pill : each))
      : [...search.pills, pill],
  };
}
