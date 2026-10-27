import { z } from "zod";
import { INVALID, type Codec } from "../page-keys.ts";
import { field, text } from "../route-field.ts";

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

/** Comma-separated names, each with its raw text (escapes kept) and its name (escapes read). */
const split = (text: string): { raw: string; name: string }[] => {
  if (text === "") return [];
  const out: { raw: string; name: string }[] = [];
  let raw = "";
  let name = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\\" && i + 1 < text.length) {
      raw += c + text[i + 1]!;
      name += text[++i]!;
    } else if (c === ",") {
      out.push({ raw, name });
      raw = name = "";
    } else {
      raw += c;
      name += c;
    }
  }
  out.push({ raw, name });
  return out;
};
const escape = (name: string) => name.replace(/[\\,]/g, (c) => `\\${c}`);

/**
 * Names (column keys, parameter names) as one string: comma joined, a name's own `,` or `\`
 * escaped with `\`. The kernel's array codec splits on every comma and drops empty names, which a
 * free-text name (`Width, Nominal`) does not survive.
 */
const namesCodec: Codec<string[]> = {
  encode: (names) => names.map(escape).join(","),
  decode: (text) => split(text).map(({ name }) => name),
};

const sortsSchema = z
  .array(z.object({ key: z.string().min(1).max(512), dir: z.enum(["asc", "desc"]) }))
  .max(8);
type Sorts = z.output<typeof sortsSchema>;

/** Sorts in order, `-` before a descending key: `-Width,Name`. An ascending key that starts with `-` escapes it. */
const sortsCodec: Codec<Sorts> = {
  encode: (sorts) =>
    sorts
      .map(({ key, dir }) => (dir === "desc" ? "-" : key.startsWith("-") ? "\\" : "") + escape(key))
      .join(","),
  decode: (text) => {
    const sorts: Sorts = split(text).map(({ raw, name }) =>
      raw.startsWith("-") ? { key: name.slice(1), dir: "desc" } : { key: name, dir: "asc" },
    );
    return sorts.every(({ key }) => key) ? sorts : INVALID;
  },
};

/**
 * A table's view (kit `TableState`): the query line, its sorts and its hidden columns, each Pea's
 * to set (MAP ruling 48: Pea shapes the query and the visible columns without asking). The query
 * is a step; typing in it is a gesture its caller marks `replace`. Sorts and columns are tweaks.
 */
export const tableFields = (query = "") => ({
  query: field(z.string().max(4096).default(query), { url: "push", agent: "set" }),
  sort: field(sortsSchema.default([]), { url: "replace", agent: "set" }, sortsCodec),
  hidden: field(
    z.array(z.string().min(1).max(512)).max(500).default([]),
    { url: "replace", agent: "set" },
    namesCodec,
  ),
});
