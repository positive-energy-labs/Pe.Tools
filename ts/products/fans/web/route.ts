import type { ContextOf } from "@pe/web-kernel/route";
import { handle } from "@pe/agent-contracts/handle";
import { bindings, fanScope } from "./src/bindings.ts";
import { hostRead } from "@pe/agent-contracts/route";
import { fansDocumentSchema, fansRouteState, fanWriteScopeMessage } from "@pe/fans-contract/fans";
import { product, fansCalcEditsSchema, fanEditPatches } from "@pe/fans-contract/product";
import { FAN_DETAIL_LIMIT, fanDetailLimitMessage } from "@pe/fans-contract/fans-read";
import { split } from "@pe/web-kernel/route";
import { screen } from "@pe/web-kernel/route/screen";
import { draw } from "@pe/web-kernel/route/draw";
import { fillBody, scrollBody } from "@pe/web-kernel/route/body";
import { overlay } from "@pe/web-kernel/route/slots/picture/overlay";
import { fanLabel, stableFanKey } from "@pe/ducts-web/calc/model";
import { describeInputHistory, editMetaSchema } from "@pe/ducts-web/calc/input-history.neutral";
import { lazyFixtures } from "@pe/ducts-web/registry";
const calcValueFixtures = lazyFixtures(() =>
  import("./src/calc/value-fixtures.ts").then((m) => m.calcValueFixtures),
);
import { presentLosses } from "@pe/ducts-web/reviews";
import { fansCalc } from "./src/calc.ts";
import { fansPanes } from "./src/panes.ts";

const declared = product.routes.fans;
export const { fields } = declared;
const fixtureRead = hostRead(product.readings.calc.handle, calcValueFixtures);
export const calc = { ...declared.core, ...fixtureRead };
const roster = { ...declared.reads.roster, ...fixtureRead };
export type FansDrawContext = ContextOf<
  typeof fields,
  typeof calc,
  typeof fansDocumentSchema,
  typeof fansCalcEditsSchema
>;
const panes = {
  [fansPanes.roster]: {
    subjectList: true,
    title: "Fans",
    purpose: "Open fan ports",
    read: roster,
    bindings,
    body: "scroll" as const,
    draw: draw("scroll", () => import("./src/mount.tsx"), "RosterBody"),
  },
  [fansPanes.inputs]: {
    title: "Inputs",
    purpose: "Edit fan inputs",
    bindings,
    kernel: "sheet" as const,
    // The shell draws this pane from the filled slot; the body kind is the frame it lays out in.
    body: "scroll" as const,
    draw: () => scrollBody(null),
  },
  [fansPanes.picture]: {
    title: "Picture",
    purpose: "Inspect fan paths",
    bindings,
    kernel: "picture" as const,
    // The shell draws this pane from the picture slot; a picture fills its pane.
    body: "fill" as const,
    draw: () => fillBody(null),
  },
  [fansPanes.ledger]: {
    title: "Ledger",
    purpose: "Inspect ESP and provenance",
    bindings,
    body: "scroll" as const,
    draw: draw("scroll", () => import("./src/mount.tsx"), "LedgerBody"),
  },
} as const;
export const module = screen(
  {
    ...declared,
    retiredPage: { fields: ["sheetPath"], values: { stage: ["sheet"] } },
    subject: {
      ...declared.subject,
      limit: { max: FAN_DETAIL_LIMIT, message: fanDetailLimitMessage, overview: true },
      read: roster,
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
    picture: {
      scope: { derive: fanScope },
    },
    edits: {
      seed: () => fansDocumentSchema.parse({}),
      work: fansRouteState,
      value: "fansWork",
      // No cross-route write (ruling 2026-11-10): /fans owns only its Work; it reads /ducts' design in its core read.
      owners: {},
      input: fansCalcEditsSchema,
      patches: fanEditPatches,
      history: editMetaSchema,
      describe: describeInputHistory,
    },
    verbs: {
      losses: {
        handle: handle("sheet.apply"),
        label: "Write to Revit",
        stageForPlan: ({ page, value, doc }) => {
          if (doc?.writeIntent.edit?.value?.walk) return;
          const rows = value?.rows ?? [];
          const fan = page.fan;
          const port =
            fan.kind === "all"
              ? rows.length === 1
                ? rows[0]
                : undefined
              : fan.ids.length === 1
                ? rows.find((row) => stableFanKey(row) === fan.ids[0])
                : undefined;
          if (!port) throw Error(fanWriteScopeMessage);
          return {
            pane: fansPanes.inputs,
            path: ["writeIntent"],
            value: { walk: { unitId: port.unitId, portIndex: port.portIndex } },
            label: "Write scope",
          };
        },
        present: (result, { value: data, doc: work }) =>
          presentLosses(result, {
            page: { stage: "calc" },
            readings: { calcSnapshot: { value: data.calcSnapshot }, fansWork: { value: work } },
          }),
      },
    },
    band: ["losses"],
  },
  {
    panes,
    overlay: overlay(() => import("./src/picture.tsx"), "FanPicture"),
    layout: split(
      "h",
      [
        split("v", [fansPanes.roster, fansPanes.inputs], {
          id: "calc-side",
          size: 360,
          sized: "end",
        }),
        split("v", [fansPanes.picture, fansPanes.ledger], {
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
  },
);
export const fansData = module.data;
export { fansLink } from "@pe/fans-contract/link";
