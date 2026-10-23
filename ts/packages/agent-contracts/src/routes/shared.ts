import { listSearchKey, listSearchCodec, emptyListSearch, pickListPill } from "../list-search.ts";
import {
  fitViewportCodec,
  planeViewportSchema,
  viewportKey,
  type PlaneViewport,
} from "../page-keys.ts";
import { field, text } from "../route-field.ts";
import { z } from "zod";

/** Chat's sidebar can accompany any route; its list view has one shareable address. */
export const threadSearchDefault = () => pickListPill(emptyListSearch(), "scope", "all");
export const threadListFields = {
  threadSearch: field(
    listSearchKey()
      .default(threadSearchDefault)
      .describe(
        "JSON {v:1,keywords:string,pills:[{field,op:'=',value}]}. Literal keywords and equality pills. Fields: target, provider, state, unread, scope. Scope values: attention, all, archived.",
      ),
    { url: "replace", agent: "set" },
    listSearchCodec,
  ),
  threadSort: field(z.enum(["", "recent", "title"]).default(""), { url: "replace", agent: "set" }),
};

/** `?demo=<action>` mounts one seed in an isolated owner: a link's word, never Pea's. */
export const demo = field(text(), { url: "replace" });

/** A plan picture's pan and zoom; null = fit. A drag replaces; Pea may set it. */
export const planViewport = field(
  viewportKey(planeViewportSchema),
  { url: "replace", agent: "set" },
  fitViewportCodec<PlaneViewport>(),
);
