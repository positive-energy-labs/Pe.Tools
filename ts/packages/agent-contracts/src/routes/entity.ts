import { z } from "zod";
import { field, text, sortField, keyedSetField } from "../route-field.ts";

/**
 * Entity routes (`/schedules`, `/families`, `/family`): stage, pod and path are the address, so
 * `/pods` deep-links a spec. A stage is a view, so Pea may move it; it runs no verb. The opened
 * spec is apply's input, so pod and path stay the person's pick and Pea only reads them. The right
 * pane (the spec, or what the last run put out) is Pea's to turn; the output dies with the page, so
 * the address never carries it.
 */
export const entityFields = {
  stage: field(z.enum(["audit", "apply", "history"]).default("audit"), {
    url: "push",
    agent: "set",
  }),
  pod: field(text(), { url: "push", agent: "read" }),
  path: field(text(1024), { url: "push", agent: "read" }),
  pane: field(z.enum(["spec", "output"]).default("spec"), { agent: "set" }),
};

/**
 * The Work slot's tab on a route that draws its Work as lines (MAP ruling 60): Pea's proposals,
 * your staged values, or all; absent = Pea's while it has any.
 */
export const workLinesField = field(z.enum(["suggestions", "edits", "all"]).optional(), {
  url: "replace",
  agent: "set",
});

/**
 * A table's view (kit `TableState`): the query line, its sorts and its hidden columns, each Pea's
 * to set (MAP ruling 48: Pea shapes the query and the visible columns without asking). The query
 * is a step; typing in it is a gesture its caller marks `replace`. Sorts and columns are tweaks.
 */
export const tableFields = (query = "") => ({
  query: field(z.string().max(4096).default(query), { url: "push", agent: "set" }),
  sort: sortField({ url: "replace", agent: "set" }),
  hidden: keyedSetField({ url: "replace", agent: "set" }),
});
