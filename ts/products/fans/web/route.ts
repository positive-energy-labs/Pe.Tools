import type { ContextOf } from "@pe/web/route";
import { handle } from "@pe/agent-contracts/handle";
import { bindings, fanScope } from "./src/bindings.ts";
import { read } from "@pe/web/route";
import { stageField } from "@pe/web/route";
import { listFields } from "@pe/web/route";
import { fansDocumentSchema, fansRouteState } from "@pe/fans-contract/fans";
import { z } from "zod";
import {
  fansCalcEditsSchema,
  type Immutable,
} from "@pe/agent-contracts";
import * as reads from "@pe/fans-contract/contract";
import { editPatches } from "@pe/ducts-domain/calc/edits";
import { field, picturePose, route, subjectSchema, split } from "@pe/web/route";
import { hostRead } from "@pe/web/host-read";
import { draw } from "@pe/web/route/draw";
import { fillBody, scrollBody } from "@pe/web/route/body";
import { overlay } from "@pe/web/route/slots/picture/overlay";
import { fanLabel, stableFanKey } from "@pe/ducts-web/calc/model";
import { describeInputHistory, editMetaSchema } from "@pe/ducts-web/calc/input-history.neutral";
import { lazyFixtures } from "@pe/ducts-web/registry";
const calcValueFixtures = lazyFixtures(() => import("./src/calc/value-fixtures.ts").then(m => m.calcValueFixtures));
import { presentLosses } from "@pe/ducts-web/reviews";
import { fansCalc } from "./src/calc.ts";

const fan = subjectSchema(32);

export const fields = {
  ...picturePose,
  fan: field(fan, { kind: "ids", ids: [] }, "subject", "push"),
  stage: stageField(["calc"]),
  ...listFields("input"),
  ...listFields("roster"),
  calcPath: field(z.string(), "", "query"),
};
export const calc = read(
  hostRead(reads.calc, calcValueFixtures),
  (page: { fan: Immutable<z.output<typeof fan>>; calcPath: string }) => ({
    fan: page.fan.kind === "all" ? "all" : page.fan.ids,
    calcPath: page.calcPath,
  }),
);
// The roster pane draws this read: the sheet refuses a fan it cannot find ("choose it from the roster"),
// and the roster is the control that clears that refusal.
const roster = read(hostRead(reads.calc, calcValueFixtures), () => ({
  fan: [],
  calcPath: "",
}));
export type FansDrawContext = ContextOf<typeof fields, typeof calc, typeof import("@pe/fans-contract/fans").fansDocumentSchema, typeof import("@pe/agent-contracts").fansCalcEditsSchema>;
export const module = route({
  key: "fans",
  retiredPage: { fields: ["sheetPath"], values: { stage: ["sheet"] } },
  host: "@pe/fans-host/host",
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
    pane: "calc-roster",
    options: (data: FansDrawContext["value"]["value"]) =>
      (data?.rows ?? []).map((row) => ({
        id: stableFanKey(row),
        label: fanLabel(row, data?.rows ?? []),
      })),
  },
  core: calc,
  reads: { roster },
  sheet: fansCalc,
  // The open fans' walk. Strands, blocker skins and the ESP readout are beyond the closed marks: the overlay hands them over.
  picture: { scope: { derive: fanScope }, overlay: overlay(() => import("./src/picture.tsx"), "FanPicture") },
  fields,
  panes: {
    "calc-roster": {
      subjectList: true,
      title: "Fans",
      purpose: "Open fan ports",
      read: roster,
      bindings,
      body: "scroll",
      draw: draw("scroll", () => import("./src/mount.tsx"), "RosterBody"),
    },
    "calc-inputs": {
      title: "Inputs",
      purpose: "Edit fan inputs",
      bindings,
      kernel: "sheet",
      // The shell draws this pane from the filled slot; the body kind is the frame it lays out in.
      body: "scroll",
      draw: () => scrollBody(null),
    },
    "calc-picture": {
      title: "Picture",
      purpose: "Inspect fan paths",
      bindings,
      kernel: "picture",
      // The shell draws this pane from the picture slot; a picture fills its pane.
      body: "fill",
      draw: () => fillBody(null),
    },
    "calc-ledger": {
      title: "Ledger",
      purpose: "Inspect ESP and provenance",
      bindings,
      body: "scroll",
      draw: draw("scroll", () => import("./src/mount.tsx"), "LedgerBody"),
    },
  },
  edits: {
    seed: () => fansDocumentSchema.parse({}),
    work: fansRouteState,
    value: "fansWork",
    // No cross-route write (ruling 2026-11-10): /fans owns only its Work; it reads /ducts' design in its core read.
    owners: {},
    input: fansCalcEditsSchema,
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
          page: { stage: "calc" },
          readings: { calcSnapshot: { value: data.calcSnapshot }, fansWork: { value: work } },
        }),
    },
  },
  band: ["losses"],
  layout: split(
    "h",
    [
      split("v", ["calc-roster", "calc-inputs"], { id: "calc-side", size: 360, sized: "end" }),
      split("v", ["calc-picture", "calc-ledger"], {
        id: "calc-main",
        size: 360,
        sized: "start",
      }),
    ],
    {
      id: "calc-layout",
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
export { fansLink } from "@pe/fans-contract/link";
