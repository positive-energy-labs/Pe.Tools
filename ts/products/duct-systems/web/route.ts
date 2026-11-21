import type { ContextOf } from "@pe/web-kernel/route";
import { systemCode } from "@pe/ducts-web/identity";
import { handle } from "@pe/agent-contracts/handle";
import { bindings } from "./src/bindings.ts";
import { hostRead, targetFocus } from "@pe/agent-contracts/route";
import { ductFocusMembership, isDuctModelFocus } from "@pe/ducts-web/cell-focus";
import { DUCTS_DETAIL_LIMIT, ductDetailLimitMessage } from "@pe/duct-systems-contract/ducts-read";
import { ductSystemsWork, product } from "@pe/duct-systems-contract/product";
import { ductsCalcEditsSchema } from "@pe/ducts-contract/duct-inputs";
import { editPatches } from "@pe/ducts-domain/calc/edits";
import { split, whenSubject } from "@pe/web-kernel/route";
import { screen } from "@pe/web-kernel/route/screen";
import { draw } from "@pe/web-kernel/route/draw";
import { fillBody, scrollBody } from "@pe/web-kernel/route/body";
import { overlay } from "@pe/web-kernel/route/slots/picture/overlay";
import { describeInputHistory, editMetaSchema } from "@pe/ducts-web/calc/input-history.neutral";
import { presentLosses, presentHeal, presentFan } from "@pe/ducts-web/reviews";
import { designCalc } from "./src/design-calc.ts";
import { lazyFixtures } from "@pe/ducts-web/registry";
const fixtures = lazyFixtures(() => import("./src/value-fixtures.ts"));
let drawingModule: Promise<typeof import("./src/screen/screen.tsx")> | undefined;
const drawings = () => (drawingModule ??= import("./src/screen/screen.tsx"));

const declared = product.routes["duct-systems"];
const withFixture = <R extends { key: string }, F extends { key: string }>(read: R, source: F) => ({
  ...read,
  ...source,
});
export const { fields } = declared;
export const roster = withFixture(
  declared.reads.roster,
  hostRead(product.readings.overview.handle, () => fixtures().then((m) => m.overviewFixtures)),
);
export const network = withFixture(
  declared.reads.network,
  hostRead(product.readings.network.handle, () => fixtures().then((m) => m.networkValueFixtures)),
);
export const pricing = withFixture(
  declared.core,
  hostRead(product.readings.pricing.handle, () => fixtures().then((m) => m.pricingFixtures)),
);
export type DuctsDrawContext = ContextOf<
  typeof fields,
  typeof pricing,
  typeof product.work,
  typeof import("@pe/ducts-contract/duct-inputs").ductsCalcEditsSchema
>;
/** What every ducts pane shares, whichever read it names: the pane's own `value` is not part of it. */
export type DuctsReads = Omit<DuctsDrawContext, "value">;
/** The systems pane draws the roster, so it still lists systems while pricing is read or refused. */
export type DuctsSystemsContext = DuctsReads &
  Pick<ContextOf<typeof fields, typeof roster>, "value">;
const evidence = (
  data: DuctsDrawContext["value"]["value"],
  work: DuctsDrawContext["cells"]["doc"],
) => ({
  page: { stage: "network" as const },
  work,
  heal: data ? data.analysis.heal : null,
  readings: { ducts: { value: data?.network }, fansWork: { value: data?.fansWork } },
});
const panes = {
  "e-systems": {
    subjectList: true,
    title: "Systems",
    purpose: "Choose a system to inspect",
    read: roster,
    bindings,
    body: "scroll",
    draw: draw("scroll", drawings, "SystemsPane"),
  },
  "e-sidebar": {
    title: "System tree",
    purpose: "Inspect the opened systems and their runs",
    bindings,
    body: "scroll",
    draw: draw("scroll", drawings, "TreePane"),
  },
  "e-rules-all": {
    title: "All-systems rules",
    purpose: "Price every read fitting type",
    bindings,
    body: "scroll",
    draw: draw("scroll", drawings, "AllRulesBody"),
  },
  "e-rules": {
    title: "This system’s rules",
    purpose: "Review fitting rules for the opened systems",
    bindings,
    body: "scroll",
    draw: draw("scroll", drawings, "RulesBody"),
  },
  "e-picture": {
    title: "Picture",
    purpose: "Inspect the model or schematic",
    bindings,
    kernel: "picture",
    // The shell draws this pane from the picture slot; a picture fills its pane.
    body: "fill",
    draw: () => fillBody(null),
  },
  design: {
    title: "Design",
    purpose: "Stage the design criteria and friction rate over the firm file",
    kernel: "sheet",
    body: "scroll",
    draw: () => scrollBody(null),
  },
  "e-inbox": {
    title: "Rulings",
    purpose: "Review assumptions and planned writes",
    bindings,
    body: "scroll",
    draw: draw("scroll", drawings, "InboxBody"),
  },
} as const;
export const module = screen(
  {
    ...declared,
    focus: targetFocus(network, (data) => ductFocusMembership(data), isDuctModelFocus),
    subject: {
      ...declared.subject,
      resetQuery: ["fan"],
      limit: { max: DUCTS_DETAIL_LIMIT, message: ductDetailLimitMessage, overview: true },
      read: roster,
      options: (data) =>
        data?.rows.map(({ name }) => ({ id: systemCode(name), label: name })) ?? [],
    },
    core: pricing,
    reads: { roster, network },
    sheet: designCalc,
    picture: { scope: "subject" },
    edits: {
      seed: () => product.work.schema.parse({}),
      work: ductSystemsWork,
      value: "ductSystemsWork",
      // No cross-route write (ruling 2026-11-10): /ducts owns only its Work; the host reads Fans Work into its core read.
      owners: {},
      input: ductsCalcEditsSchema,
      patches: (input) => editPatches(input),
      history: editMetaSchema,
      describe: describeInputHistory,
    },
    verbs: {
      losses: {
        handle: handle("sheet.apply"),
        label: "Write to Revit",
        present: (result, { value: data, doc: work }) =>
          presentLosses(result, evidence(data, work)),
      },
      heal: {
        handle: handle("ducts.apply-heal"),
        label: "Heal",
        present: (result, { value: data, doc: work }) => presentHeal(result, evidence(data, work)),
      },
      assign: {
        handle: handle("ducts.apply-assign-fan"),
        label: "Make the fan",
        present: (result, { value: data, doc: work }) => presentFan(result, evidence(data, work)),
      },
    },
    band: ["losses", "heal", "assign"],
  },
  {
    overlay: overlay(drawings, "NetworkPicture"),
    panes,
    layout: split(
      "h",
      [
        split(
          "v",
          [
            split("v", ["e-systems", whenSubject("e-sidebar")], {
              id: "scope-upper",
              size: 240,
              sized: "start",
            }),
            split(
              "v",
              [
                split("v", ["e-rules-all", whenSubject("e-rules")], {
                  id: "scope-lower",
                  size: 176,
                  sized: "start",
                }),
                "design",
              ],
              { id: "design-lower", size: 220, sized: "end" },
            ),
          ],
          { id: "stack", size: 300, sized: "end" },
        ),
        split("h", ["e-picture", "e-inbox"], {
          id: "drawing",
          size: 340,
          sized: "end",
          minSize: 260,
          maxSize: 520,
          minOtherSize: 360,
          rails: { end: { title: "Rulings" } },
        }),
      ],
      {
        id: "sidebar",
        size: 420,
        sized: "start",
        minSize: 280,
        maxSize: 760,
        minOtherSize: 400,
        rails: { start: { title: "Systems" } },
      },
    ),
  },
);
export const ductsData = module.data;
