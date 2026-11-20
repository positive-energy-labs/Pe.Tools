import { listSearchKey, listSearchCodec, emptyListSearch, pickListPill } from "../list-search.ts";
import { type Codec } from "../page-keys.ts";
import { textCodec } from "../route-field.ts";
import { z } from "zod";

/** Chat's sidebar can accompany any route; its list view has one shareable address. */
export const threadSearchDefault = () => pickListPill(emptyListSearch(), "scope", "all");
/** One field object feeds both the kernel Page and address projections. */
const sharedQuery = <S extends z.ZodType, C extends Codec<unknown>>(schema: S, codec: C) => ({
  schema,
  codec,
  initial: schema.parse(undefined),
  role: "query" as const,
  url: "replace" as const,
  agent: "set" as const,
});
export const threadListFields = {
  threadSearch: sharedQuery(
    listSearchKey()
      .default(threadSearchDefault)
      .describe(
        "JSON {v:1,keywords:string,pills:[{field,op:'=',value}]}. Literal keywords and equality pills. Fields: target, provider, state, unread, scope. Scope values: attention, all, archived.",
      ),
    listSearchCodec,
  ),
  threadSort: sharedQuery(z.enum(["", "recent", "title"]).default(""), textCodec),
};
