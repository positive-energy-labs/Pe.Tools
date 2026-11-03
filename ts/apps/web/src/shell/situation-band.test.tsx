import { expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { validateRouteGraph, type VerbDecl } from "@pe/agent-contracts";
import { builtinAdmission } from "./legacy-route-door";
import { rankVerbs, TimelineHead } from "./situation-band";
import { createRouteTimeline } from "./timeline";
import { PageControl } from "./situation-fields";
import { ductsGraph } from "../ducts/graph";

const verb = (extra: Partial<VerbDecl>): VerbDecl => ({
  kind: "command",
  label: "v",
  input: z.object({}),
  review: "none",
  ...extra,
});

test("the band frames the declared primary, else the first model write, keeping the rest in order", () => {
  const verbs = {
    preview: verb({ effect: "query" }),
    apply: verb({ effect: "command" }),
    heal: verb({ effect: "command" }),
  };
  expect(rankVerbs(["preview", "apply", "heal"], verbs)).toEqual(["apply", "preview", "heal"]);
  expect(
    rankVerbs(["preview", "apply", "heal"], { ...verbs, heal: verb({ primary: true }) }),
  ).toEqual(["heal", "preview", "apply"]);
  expect(rankVerbs([], verbs)).toEqual([]);
});

test("a bare string field draws no free-text box unless it declares one", () => {
  const draw = (decl: object) =>
    renderToStaticMarkup(
      <PageControl
        id="pod"
        field={{ ...field(z.string().default(""), {}), ...decl } as never}
        value=""
        enabled
        set={() => {}}
      />,
    );
  expect(draw({})).toBe("");
  expect(draw({ editor: "text" })).toContain("<input");
});

test("ducts refreshes from the pane head, never from a stage verb", () => {
  expect(ductsGraph.refresh).toBe("refresh");
  expect(ductsGraph.stages.network!.verbs).not.toContain("refresh");
  const refused = validateRouteGraph({
    ...ductsGraph,
    stages: { network: { ...ductsGraph.stages.network!, verbs: ["refresh"] } },
  } as never);
  expect(refused.map((r) => r.message)).toContain("'refresh' is the pane head's refresh");
});

test("a stale builtin stamp refuses that route with the fix, instead of throwing", () => {
  const stale = { ...ductsGraph, moduleHash: "0".repeat(64) };
  expect(builtinAdmission(stale as never)).toMatch(/hash.*codegen:routes/);
});

test("an open consent window draws its countdown with Reject, refused on the fixture lane", () => {
  // TimelineHead reads the owner's timeline, command capability, verbs and Work journal (none here).
  const owner = {
    timeline: createRouteTimeline(),
    commandRefusal: "Native commands unavailable",
    verbs: {},
    subscribe: () => () => {},
    version: () => 0,
    snapshot: () => ({}),
    journals: new Map(),
  } as never as Extract<
    Parameters<typeof TimelineHead>[0]["owner"],
    { timeline: ReturnType<typeof createRouteTimeline> }
  >;
  owner.timeline.append({
    kind: "receipt",
    at: Date.now(),
    verb: "apply",
    receiptId: "r1",
    outcome: {
      id: "r1",
      state: "queued",
      input: {},
      receiptId: "r1",
      consentWindow: { requestId: "q1", deadline: new Date(Date.now() + 30_000).toISOString() },
    },
  });
  const html = renderToStaticMarkup(<TimelineHead owner={owner} history={null} thread="t1" />);
  expect(html).toContain("Reject?");
  expect(html).toMatch(/apply · [23]\ds/);
  expect(html).toMatch(/aria-label="Reject apply" aria-disabled="true"[^>]*>.*Reject\?/);
});

test("Pea's preview receipt after a Work edit heads the Timeline with its caller and state", () => {
  const step = { label: "Allowance return", at: Date.now() - 5000, by: "human", press: "p1" };
  const journal = {
    last: { kind: "apply", step, by: "human" },
    undo: [step],
    redo: [],
    revision: 3,
  };
  const owner = {
    timeline: createRouteTimeline(),
    fixture: null,
    verbs: { preview: verb({ does: "ducts.preview-losses" }) },
    subscribe: () => () => {},
    version: () => 0,
    snapshot: () => ({ workKey: { binding: "host", route: "ducts" } }),
    journalRefusal: () => null,
    journals: { get: () => ({ read: () => journal }) },
  } as never as Extract<
    Parameters<typeof TimelineHead>[0]["owner"],
    { timeline: ReturnType<typeof createRouteTimeline> }
  >;
  const head = () => renderToStaticMarkup(<TimelineHead owner={owner} history={null} />);
  expect(head()).toContain("Allowance return");
  for (const state of ["running", "succeeded"] as const)
    owner.timeline.append({
      kind: "receipt",
      at: Date.now(),
      verb: "preview",
      receiptId: `r1:${state}`,
      basis: { receipt: { caller: { kind: "pea", thread: "t1" } } },
      outcome: { id: "r1", state, input: {}, receiptId: "r1" },
    });
  expect(head()).toMatch(
    /<span>preview<\/span><span data-slot="timeline-state">Pea · succeeded · /,
  );
  expect(head()).not.toContain("<span>Allowance return</span>");
});
