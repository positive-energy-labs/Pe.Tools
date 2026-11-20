// Compiled by this package's `check`, never run: every `@ts-expect-error` is a screen `tsc` must refuse.
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
