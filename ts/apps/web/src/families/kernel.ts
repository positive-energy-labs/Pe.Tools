import { commandCatalogAxes } from "../../../../packages/agent-contracts/src/command-axes";
import { z } from "zod";
import { createElement } from "react";
import {
  commands,
  familiesRouteState,
  familiesObservationSchema,
  familyCellKey,
  familyCellValueSchema,
  familyCellAddress,
  transitionPatches,
  applyPatches,
  workKeySchema,
} from "@pe/agent-contracts";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { IdentityId } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { identityCodecs } from "../shell/page-port";
import { familiesReads } from "../../../../packages/mcps/src/shared/families-client";

// TODO: W2 cutover requires sourceRouteServices to preserve progressive part values and
// invalidate completed evidence on stale/pending (kernel.test.ts boundary witness).
// TODO: Enroll Families progressive read/Stop sources and its host Work fingerprint.
// Keep the legacy mount until the driven read -> edit -> preview chain is complete.
const scopeId = identityCodecs.local.encode({ namespace: "families", subject: "draft" });
if (!scopeId.ok) throw Error(scopeId.reason);
export const familiesScopeId = scopeId.value;
const empty = { page: [], work: [], readings: [] } as const;
const retained = { evidence: "scope", resource: "scope" } as const;
const workKeys = ["scope", "cells", "patch", "excluded", "takenAt"] as const;
export const familiesData = {
  version: 1,
  capabilities: ["work", "native-write", "geometry"],
  key: "families",
  address: "/families",
  name: "Families",
  directory: {
    group: "Build / audit families",
    summary: "Audit and reconcile loaded family parameters",
    label: "Family Foundry",
    icon: "Table2",
    exposure: "Main",
    surfaces: { web: "full", pwa: "full", tray: false },
    aliases: ["audit", "parameters"],
    runtimeNeed: "Revit for model actions",
    listed: true,
    satellites: [],
    resume: "document",
  },
  identities: { scope: { kind: "local", codec: "local" } },
  fields: {
    scope: {
      role: "subject",
      schema: "subject",
      codec: "json",
      initial: familiesScopeId,
      cardinality: "one",
      identity: "scope",
      picker: { reading: "scopes", options: "pickScope" },
      url: "push",
      share: true,
      agent: "set",
    },
    selected: { role: "selection", kinds: ["scope"] },
  },
  subject: {
    field: "scope",
    noun: "family draft scope",
    roster: "scopes",
    detail: "matrix",
    pane: "main",
  },
  work: { route: "families", schema: "work", version: 1, migrations: {} },
  readings: {
    scopes: {
      kind: "derive",
      output: "scopes",
      derive: "scopes",
      deps: empty,
      demand: "visible",
      retain: retained,
      refresh: "dependencies",
    },
    matrix: {
      kind: "use",
      entry: "families.read",
      args: "matrixArgs",
      deps: empty,
      demand: "explicit",
      retain: retained,
      refresh: "explicit",
    },
    preview: {
      kind: "use",
      entry: "families.apply.preview",
      args: "previewArgs",
      deps: empty,
      demand: "explicit",
      retain: retained,
      refresh: "explicit",
    },
  },
  verbs: {
    edit: {
      kind: "work",
      input: "edit",
      label: "Edit family value",
      review: "none",
      patches: "edit",
      ready: "editReady",
      deps: { page: [], work: workKeys, readings: ["matrix"] },
      captures: [],
    },
    revert: {
      kind: "work",
      input: "key",
      label: "Revert family value",
      review: "none",
      patches: "revert",
      deps: { page: [], work: ["cells"], readings: [] },
      captures: [],
    },
    apply: {
      kind: "command",
      entry: "families.apply",
      intent: "apply",
      input: "none",
      label: "Apply families",
      review: "shown",
      ready: "applyReady",
      deps: { page: [], work: workKeys, readings: ["matrix"] },
      captures: [],
    },
    read: {
      kind: "query",
      entry: "families.read",
      reading: "matrix",
      args: "read",
      input: "read",
      label: "Read families",
      review: "none",
      cancellation: "scope",
      deps: { page: [], work: ["scope"], readings: [] },
      captures: [],
    },
    stop: {
      kind: "command",
      entry: "families.cancel-read",
      intent: "stop",
      input: "stop",
      label: "Stop family read",
      review: "none",
      deps: empty,
      captures: [],
    },
  },
  panes: {
    main: {
      label: "Families",
      purpose: "Audit family values",
      draws: ["matrix"],
      verbs: ["read", "stop", "edit", "revert", "apply"],
      body: "main",
    },
  },
  layout: { kind: "pane", id: "main" },
  stages: { audit: { word: "Auditing", panes: ["main"], verbs: ["read", "stop", "apply"] } },
  stageOrder: ["audit"],
  predicates: {},
  cells: {},
  workFields: {
    cells: { label: "family parameters", internal: false },
    takenAt: { label: "capture time", internal: true },
  },
  seeds: {},
  needs: "project",
  resetOnTarget: [],
  observe: [],
} as const satisfies RouteGraphJson;
export const familiesSchemas = {
  subject: z
    .custom<IdentityId<"local">>((v) => typeof v === "string" && identityCodecs.local.decode(v).ok)
    .nullable(),
  scopes: z.array(z.object({ id: z.string(), label: z.string() })),
  work: familiesRouteState.schema,
  edit: z.object({
    address: z.object({ familyName: z.string(), typeName: z.string(), parameter: z.string() }),
    value: familyCellValueSchema,
    current: z.string(),
  }),
  key: z.string(),
  none: z.strictObject({}),
  read: familiesReads["families.read"].input,
  stop: familiesReads["families.cancel-read"].input,
};
const readAxes = {
  subject: "Elements",
  touches: ["Metadata"],
  effect: "Read",
  cost: "Cheap",
  cardinality: "One",
} as const;
export const familiesEntries = {
  "families.read": {
    input: familiesReads["families.read"].input.extend({ work: workKeySchema }),
    output: familiesObservationSchema,
    axes: readAxes,
  },
  "families.cancel-read": {
    input: familiesReads["families.cancel-read"].input,
    output: z.object({ cancelled: z.literal(true) }),
    axes: { ...readAxes, effect: "SessionWrite" as const },
  },
  "families.apply": {
    input: commands["families.apply"].input,
    output: commands["families.apply"].result,
    axes: { ...commandCatalogAxes["families.apply"], effect: "ModelWrite" as const },
  },
  "families.apply.preview": {
    input: commands["families.apply.preview"].input,
    output: commands["families.apply.preview"].result,
    axes: commandCatalogAxes["families.apply.preview"],
  },
};
const source = { module: "families/kernel.ts", export: "familiesModule" };
export const familiesBodies = {
  scopes: {
    slot: "readings.scopes.derive",
    kind: "derive",
    source,
    run: () => [{ id: familiesScopeId, label: "Family draft scope" }],
  },
  pickScope: {
    slot: "fields.scope.picker.options",
    kind: "picker",
    source,
    run: () => [{ id: familiesScopeId, label: "Family draft scope" }],
  },
  matrixArgs: {
    slot: "readings.matrix.args",
    kind: "args",
    source,
    run: () => {
      throw Error("Use Read families with an accepted Work basis");
    },
  },
  previewArgs: {
    slot: "readings.preview.args",
    kind: "args",
    source,
    run: () => {
      throw Error("Prepare Apply families from accepted Work");
    },
  },
  read: {
    slot: "verbs.read.args",
    kind: "args",
    source,
    run: (ctx, input) => {
      const work = ctx.workBasis?.token.scope.identity.work;
      if (!work || ctx.workBasis?.workRevision == null) throw Error("Accepted Work unavailable");
      return { ...input, work, expectedRevision: ctx.workBasis.workRevision };
    },
  },
  stop: { slot: "verbs.stop.intent", kind: "intent", source, run: (_, input) => input },
  editReady: {
    slot: "verbs.edit.ready",
    kind: "ready",
    source,
    run: (ctx) =>
      ctx.readings.matrix.current && ctx.readings.matrix.value.capturedAt === ctx.work.takenAt
        ? true
        : "Read these families before editing",
  },
  edit: {
    slot: "verbs.edit.patches",
    kind: "work",
    source,
    run: (ctx, input) => {
      const key = familyCellKey(input.address);
      const patches = transitionPatches(["cells"], key, ctx.work.cells[key] ?? {}, {
        kind: "set",
        rung: { value: input.value },
        baseline: { value: { value: input.current, storageType: input.value.storageType } },
      });
      const prior = familiesRouteState.schema.parse(ctx.work);
      const result = applyPatches(
        familiesRouteState,
        { version: 1, revision: 0, doc: prior },
        "human",
        patches,
        0,
      );
      if (!result.ok) throw Error("Invalid family cell edit");
      return [{ path: ["cells"], value: result.envelope.doc.cells }];
    },
  },
  revert: {
    slot: "verbs.revert.patches",
    kind: "work",
    source,
    run: (ctx, key) => {
      familyCellAddress(key);
      const cells = { ...ctx.work.cells };
      delete cells[key];
      return [{ path: ["cells"], value: cells }];
    },
  },
  apply: { slot: "verbs.apply.intent", kind: "intent", source, run: () => ({}) },
  applyReady: {
    slot: "verbs.apply.ready",
    kind: "ready",
    source,
    run: (ctx) => {
      if (!ctx.readings.matrix.current || ctx.readings.matrix.value.capturedAt !== ctx.work.takenAt)
        return "Read these families before planning";
      if (ctx.work.patch.edit && Object.values(ctx.work.cells).some((c) => c.edit))
        return "Stage either a patch or per-type cells";
      return true;
    },
  },
  main: {
    slot: "panes.main.body",
    kind: "pane",
    source,
    run: (ctx) =>
      createElement(
        "output",
        { "aria-label": "Family Work" },
        !ctx.readings.matrix.current
          ? ctx.readings.matrix.reason
          : JSON.stringify(ctx.work?.cells ?? {}),
      ),
  },
} satisfies BodyBindings<typeof familiesData, typeof familiesSchemas, typeof familiesEntries>;
export const familiesModule = {
  data: familiesData,
  schemas: familiesSchemas,
  entries: familiesEntries,
  bodies: familiesBodies,
  identities: { local: identityCodecs.local },
  codecs: {
    json: {
      encode: JSON.stringify,
      decode: (text: string) => {
        try {
          return { ok: true as const, value: JSON.parse(text) };
        } catch {
          return { ok: false as const, reason: "Invalid family scope" };
        }
      },
    },
  },
};
