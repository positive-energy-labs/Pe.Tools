// Compiled by this package's `check`, never run: every `@ts-expect-error` is a screen `tsc` must refuse.
import type { ReadHandle } from "@pe/agent-contracts/handle";
import { product } from "@pe/agent-contracts/product";
import { scrollBody } from "../body.ts";
import { paneLayout } from "../defaults.ts";
import { screen } from "../screen.ts";

const tiny = {
  key: "tiny",
  name: "Tiny",
  directory: {
    aliases: [],
    exposure: "Main",
    group: "Calculate loads & airflow",
    icon: "Wind",
    label: "Tiny",
    listed: false,
    resume: "document",
    runtimeNeed: "Nothing",
    satellites: [],
    summary: "A two pane route",
    surfaces: { pwa: "full", tray: false, web: "full" },
  },
  fields: {},
  panes: ["list", "detail"],
} as const;
const pane = {
  title: "Pane",
  purpose: "Draw",
  body: "scroll",
  draw: () => scrollBody(null),
} as const;
const layout = paneLayout("list");
screen(tiny, { panes: { list: pane, detail: pane }, layout });

// @ts-expect-error a named pane with no body
screen(tiny, { panes: { list: pane }, layout });
// @ts-expect-error a pane the route does not name
screen(tiny, { panes: { list: pane, detail: pane, extra: pane }, layout });

// A route as `product()` returns it is what `screen()` takes: its key, name, directory and built reads.
declare const roster: ReadHandle<"tiny.roster", { level: string }, number>;
const declared = product({
  id: "tiny",
  says: "Tiny",
  homes: {},
  cells: {},
  readings: { roster: { handle: roster, sources: [] } },
  commands: {},
  routes: {
    tiny: { ...tiny, core: ["roster", () => ({ level: "" })], reads: { list: "roster" } },
  },
});
const drawn = screen(declared.routes.tiny, { panes: { list: pane, detail: pane }, layout });
// @ts-expect-error a product route still needs every pane drawn
screen(declared.routes.tiny, { panes: { list: pane }, layout });
export const used = drawn;
