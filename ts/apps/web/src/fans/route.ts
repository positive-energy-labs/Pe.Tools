import type { ContextOf } from "../route/defaults";
import { handle } from "@pe/agent-contracts/handle";
import { bindings, fanScope } from "./bindings";
import { read } from "../route/defaults";
import { stageField } from "../route/defaults";
import { listFields } from "../route/defaults";
import { fansDocumentSchema, fansRouteState } from "../../../../packages/agent-contracts/src/fans.ts";
import { z } from "zod";
import {
  fansSheetEditsSchema,
  routeAddress,
  type Immutable,
  type SubjectRefCode,
} from "@pe/agent-contracts";
import { reads } from "./reads.ts";
import { editPatches } from "@pe/ducts-domain/sheet/index";
import { field, picturePose, route, subjectSchema, split } from "../route/defaults.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";
import { fillBody, scrollBody } from "../route/body.ts";
import { overlay } from "../route/slots/picture/overlay.tsx";
import { fanLabel, stableFanKey } from "../ducts/sheet/model.ts";
import { describeInputHistory, editMetaSchema } from "../ducts/sheet/input-history.neutral.ts";
import { sheetValueFixtures } from "../ducts/sheet/value-fixtures.ts";
import { presentLosses } from "../ducts/reviews.ts";
import { fansSheet } from "./sheet.ts";

const fan = subjectSchema(32);

export const fields = {
  ...picturePose,
  fan: field(fan, { kind: "ids", ids: [] }, "subject", "push"),
  stage: stageField(["sheet"]),
  ...listFields("input"),
  ...listFields("roster"),
  sheetPath: field(z.string(), "", "query"),
};
export const sheet = read(
  hostRead(reads.sheet, sheetValueFixtures),
  (page: { fan: Immutable<z.output<typeof fan>>; sheetPath: string }) => ({
    fan: page.fan.kind === "all" ? "all" : page.fan.ids,
    sheetPath: page.sheetPath,
  }),
);
// The roster pane draws this read: the sheet refuses a fan it cannot find ("choose it from the roster"),
// and the roster is the control that clears that refusal.
const roster = read(hostRead(reads.sheet, sheetValueFixtures), () => ({
  fan: [],
  sheetPath: "",
}));
export type FansDrawContext = ContextOf<typeof fields, typeof sheet, typeof import("../../../../packages/agent-contracts/src/fans.ts").fansDocumentSchema, typeof import("@pe/agent-contracts").fansSheetEditsSchema>;
export const module = route({
  key: "fans",
  host: "./host.ts",
  name: "Fans",
  directory: {
    aliases: ["fan", "ESP", "pressure"],
    exposure: "Main",
    group: "Calculate loads & airflow",
    icon: "Wind",
    label: "Fan ESP",
    listed: true,
    resume: "document",
    runtimeNeed: "Revit for model reads and writes",
    satellites: [],
    summary: "Inspect fan paths, inputs and pressure requirements",
    surfaces: { pwa: "full", tray: false, web: "full" },
  },
  subject: {
    field: "fan",
    read: roster,
    noun: "fan",
    pane: "sheet-roster",
    options: (data: FansDrawContext["value"]["value"]) =>
      (data?.rows ?? []).map((row) => ({
        id: stableFanKey(row),
        label: fanLabel(row, data?.rows ?? []),
      })),
  },
  core: sheet,
  reads: { roster },
  sheet: fansSheet,
  // The open fans' walk. Strands, blocker skins and the ESP readout are beyond the closed marks: the overlay hands them over.
  picture: { scope: { derive: fanScope }, overlay: overlay(() => import("./picture.tsx"), "FanPicture") },
  fields,
  panes: {
    "sheet-roster": {
      subjectList: true,
      title: "Fans",
      purpose: "Open fan ports",
      read: roster,
      bindings,
      body: "scroll",
      draw: draw("scroll", () => import("./mount.tsx"), "RosterBody"),
    },
    "sheet-inputs": {
      title: "Inputs",
      purpose: "Edit fan inputs",
      bindings,
      kernel: "sheet",
      // The shell draws this pane from the filled slot; the body kind is the frame it lays out in.
      body: "scroll",
      draw: () => scrollBody(null),
    },
    "sheet-picture": {
      title: "Picture",
      purpose: "Inspect fan paths",
      bindings,
      kernel: "picture",
      // The shell draws this pane from the picture slot; a picture fills its pane.
      body: "fill",
      draw: () => fillBody(null),
    },
    "sheet-ledger": {
      title: "Ledger",
      purpose: "Inspect ESP and provenance",
      bindings,
      body: "scroll",
      draw: draw("scroll", () => import("./mount.tsx"), "LedgerBody"),
    },
  },
  edits: {
    seed: () => fansDocumentSchema.parse({}),
    work: fansRouteState,
    value: "fansWork",
    // No cross-route write (ruling 2026-11-10): /fans owns only its Work; it reads /ducts' design in its core read.
    owners: {},
    input: fansSheetEditsSchema,
    patches: (input) => editPatches(input),
    history: editMetaSchema,
    describe: describeInputHistory,
  },
  verbs: {
    losses: {
      handle: handle("sheet.apply"),
      label: "Write to Revit",
      present: (result, { value: data, doc: work }) =>
        presentLosses(result, {
          page: { stage: "sheet" },
          readings: { sheetSnapshot: { value: data.sheetSnapshot }, fansWork: { value: work } },
        }),
    },
  },
  band: ["losses"],
  layout: split(
    "h",
    [
      split("v", ["sheet-roster", "sheet-inputs"], { id: "sheet-side", size: 360, sized: "end" }),
      split("v", ["sheet-picture", "sheet-ledger"], {
        id: "sheet-main",
        size: 360,
        sized: "start",
      }),
    ],
    {
      id: "sheet-layout",
      size: 420,
      sized: "start",
      minOtherSize: 360,
      minSize: 280,
      rails: { start: { title: "Fans" } },
    },
  ),
});
export const fansData = module.data;
export const fansHostModule = module.host;
export function fansLink(ids: SubjectRefCode[], search: Readonly<Record<string, unknown>>) {
  return routeAddress("fans").link({
    ...Object.fromEntries(
      ["target", "fixture", "thread"].flatMap((key) =>
        typeof search[key] === "string" ? [[key, search[key]]] : [],
      ),
    ),
    fan: { kind: "ids", ids },
  });
}
