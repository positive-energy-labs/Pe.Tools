import { draftCellSchema } from "@pe/agent-contracts";
import { workHandleSchema, writePreviewSchema } from "@pe/agent-contracts";

// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";

import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";

import { identityCodecs } from "./page-port";

const data = {
  version: 1,
  capabilities: [],
  key: "note",
  address: "/note",
  name: "Note",
  directory: {
    group: "Test",
    summary: "Composition witness",
    label: "Test",
    icon: "File",
    exposure: "Preview",
    surfaces: { web: "full", pwa: "full", tray: false },
    aliases: [],
    runtimeNeed: "Host",
    listed: true,
    satellites: [],
  },
  identities: { note: { kind: "local", codec: "local" } },
  fields: {
    note: {
      role: "subject",
      schema: "subject",
      codec: "json",
      initial: null,
      cardinality: "one",
      identity: "note",
      picker: { reading: "notes", options: "pick" },
      url: "push",
      share: true,
      agent: "set",
    },
    selected: { role: "selection", kinds: ["note"] },
    query: {
      role: "query",
      schema: "text",
      codec: "text",
      initial: "",
      url: "replace",
      share: true,
      agent: "set",
    },
    pose: {
      role: "pose",
      schema: "pose",
      codec: "json",
      initial: { x: 0 },
      url: "replace",
      share: true,
      agent: "set",
    },
  },
  subject: { field: "note", noun: "note", roster: "notes", detail: "notes", pane: "main" },
  readings: {
    notes: {
      kind: "use",
      entry: "notes.read",
      args: "args",
      deps: { page: ["query"], work: [], readings: [] },
      demand: "visible",
      retain: { evidence: "scope", resource: "scope" },
      refresh: "explicit",
    },
    label: {
      kind: "derive",
      output: "text",
      derive: "label",
      demand: "visible",
      retain: { evidence: "scope", resource: "scope" },
      refresh: "dependencies",
      deps: { page: [], work: [], readings: ["notes"] },
    },
  },
  verbs: {},
  panes: {
    main: { label: "Note", purpose: "Read", draws: ["notes", "label"], verbs: [], body: "main" },
  },
  layout: { kind: "pane", id: "main" },
  stages: { main: { word: "Note", panes: ["main"], verbs: [] } },
  stageOrder: ["main"],
  predicates: {},
  cells: {},
  workFields: {},
  seeds: { sample: { title: "Sample", load: "seed" } },
  needs: "nothing",
  resetOnTarget: [],
  observe: [],
} as const satisfies RouteGraphJson;
const schemas = {
  subject: z
    .custom<
      import("../../../../packages/agent-contracts/src/route-kernel-page").IdentityId<"local">
    >((value) => typeof value === "string" && identityCodecs.local.decode(value).ok)
    .nullable(),
  text: z.string(),
  pose: z.object({ x: z.number() }),
};
const entries = {
  "notes.read": {
    input: z.object({ query: z.string() }),
    output: z.string(),
    axes: {
      subject: "None",
      touches: ["Metadata"],
      effect: "Read",
      cost: "Cheap",
      cardinality: "One",
    },
  },
} as const;
const source = { module: "witness.ts", export: "module" };
const bodies = {
  args: {
    slot: "readings.notes.args",
    kind: "args",
    source,
    run: (ctx) => ({ query: ctx.page.query }),
  },
  label: {
    slot: "readings.label.derive",
    kind: "derive",
    source,
    run: (ctx) => (ctx.readings.notes.current ? `Label ${ctx.readings.notes.value}` : "pending"),
  },
  pick: { slot: "fields.note.picker.options", kind: "picker", source, run: () => [] },
  main: {
    slot: "panes.main.body",
    kind: "pane",
    source,
    run: (ctx) =>
      createElement(
        "span",
        null,
        ctx.readings.label.current ? ctx.readings.label.value : "pending",
      ),
  },
  seed: {
    slot: "seeds.sample.load",
    kind: "seed",
    source,
    run: () => ({ readings: { notes: "fixture" } }),
  },
} satisfies BodyBindings<typeof data, typeof schemas, typeof entries>;
const module = {
  data,
  schemas,
  entries,
  bodies,
  identities: { local: identityCodecs.local },
  codecs: {
    text: { encode: String, decode: (value: string) => ({ ok: true as const, value }) },
    json: {
      encode: JSON.stringify,
      decode: (text: string) => {
        try {
          return { ok: true as const, value: JSON.parse(text) };
        } catch {
          return { ok: false as const, reason: "Invalid JSON" };
        }
      },
    },
  },
};
async function admitted(
  explicit = false,
  query = false,
  amendment: {
    data?: Record<string, unknown>;
    bodies?: Record<string, unknown>;
    schemas?: Record<string, z.ZodType>;
    sources?: Record<string, unknown>;
    landing?: boolean;
    queryFromPage?: boolean;
  } = {},
) {
  const selectedModule = {
    ...module,
    sources: amendment.sources ?? {},
    schemas: {
      ...schemas,
      ids: z.object({ elementIds: z.array(z.number()) }),
      ...amendment.schemas,
    },
    bodies: {
      ...bodies,
      ...amendment.bodies,
      ...(query
        ? {
            queryArgs: {
              slot: "verbs.capture.args",
              kind: "args",
              source,
              run: (ctx: { page: { query?: string } }, input: { elementIds: number[] }) => ({
                query: `${input.elementIds.join(",")}${amendment.queryFromPage ? ctx.page.query : ""}`,
              }),
            },
            main: { ...bodies.main, run: (ctx: unknown) => ctx },
          }
        : {}),
    },
    data: {
      ...data,
      ...amendment.data,
      ...(query
        ? {
            verbs: {
              capture: {
                kind: "query" as const,
                entry: "notes.read",
                args: "queryArgs",
                input: "ids",
                label: "Capture",
                review: "none" as const,
                cancellation: "scope" as const,
                ...(amendment.landing ? { lands: "landQuery" } : {}),
                deps: { page: amendment.queryFromPage ? ["query"] : [], work: [], readings: [] },
                captures: [],
              },
            },
            panes: { main: { ...data.panes.main, verbs: ["capture"] } },
          }
        : {}),
      readings: {
        ...data.readings,
        ...((amendment.data?.readings ?? {}) as typeof data.readings),
        notes: {
          ...((amendment.data?.readings as typeof data.readings | undefined)?.notes ??
            data.readings.notes),
          demand: explicit ? ("explicit" as const) : ("visible" as const),
        },
      },
    },
  };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: selectedModule.data,
    hostVersion: "test",
    variants: [{ client: "web" as const, entry: "witness.ts" }],
    modules: [{ id: "witness.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };

  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    note: {
      module: selectedModule,
      closure: { envelope, fingerprint },
      catalog: [{ key: "notes.read", ...entries["notes.read"].axes, uses: [] }],
    },
  });
  const result = (await inventory.prepare("note", fingerprint)).admit(selectedModule);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.route;
}
const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close());
});

async function workRoute(
  review: "none" | "shown" = "none",
  modelWrite = false,
  needs: "nothing" | "document" = "nothing",
  presenter?: (result: unknown, evidence: unknown) => unknown,
  cellBodies: false | true | "draft" = false,
  landing?: {
    run: (result: unknown, page: unknown) => unknown;
    output: z.ZodType;
    pane?: (ctx: unknown) => unknown;
    row?: boolean;
  },
  readingWork = false,
) {
  const workData = {
    ...data,
    needs,
    ...(cellBodies
      ? ({
          cells: {
            amount: {
              segment: null,
              key: "text",
              value: "number",
              groupOf: "cellGroup",
              ...(cellBodies === "draft" ? {} : { show: "cellShow" }),
              label: "cellLabel",
              focus: "cellFocus",
              deps: {
                page: ["query"],
                work: cellBodies === "draft" ? [] : ["amount"],
                readings: ["notes"],
              },
            },
          },
        } as const)
      : {}),
    capabilities: ["work", "native-write"] as const,
    work: { route: "note", schema: "work", version: 1, migrations: {} },
    workFields: { amount: { label: "amount", internal: false } },
    ...(needs === "document" ? {} : { workSubject: "note" }),
    readings: {
      ...data.readings,
      ...(readingWork
        ? {
            notes: {
              ...data.readings.notes,
              deps: { page: ["query"], work: ["amount"], readings: [] },
            },
          }
        : {}),
      ...(modelWrite
        ? {
            preview: {
              ...data.readings.notes,
              entry: "native.write.preview",
              args: "previewArgs",
              demand: "explicit" as const,
              deps: { page: [], work: [], readings: [] },
            },
          }
        : {}),
    },
    verbs: {
      native: {
        kind: "command" as const,
        entry: "native.write",
        intent: "native",
        ...(landing ? { lands: "landNative" } : {}),
        ...(presenter ? { present: "nativePresent" as const } : {}),
        input: "number",
        label: "Native",
        review: "shown" as const,
        deps: { page: [], work: ["amount"], readings: [] },
        captures: [],
      },
      change: {
        kind: "work" as const,
        input: "number",
        label: "Change",
        review,
        deps: { page: [], work: ["amount"], readings: [] },
        captures: [],
        patches: "change",
      },
    },
    panes: {
      ...data.panes,
      main: {
        ...data.panes.main,
        verbs: landing?.row
          ? { choose: "chooseChange", allowed: ["change"], row: "number" }
          : ["change"],
      },
    },
  } as const;
  const workModule = {
    ...module,
    data: workData,
    entries: {
      ...entries,
      "native.write": {
        input: z.object({ amount: z.number() }),
        output: landing?.output ?? z.unknown(),
        axes: {
          ...entries["notes.read"].axes,
          effect: modelWrite ? ("ModelWrite" as const) : ("SessionWrite" as const),
        },
        ...(modelWrite ? { input: z.strictObject({ work: workHandleSchema }) } : {}),
      },
      ...(modelWrite
        ? {
            "native.write.preview": {
              input: z.strictObject({ work: workHandleSchema }),
              output: writePreviewSchema,
              axes: {
                ...entries["notes.read"].axes,
                effect: "TransactRead" as const,
                rollsBack: true,
              },
            },
          }
        : {}),
    },
    schemas: {
      ...schemas,
      work: z.object({ amount: cellBodies === "draft" ? draftCellSchema(z.number()) : z.number() }),
      number: z.number(),
    },
    bodies: {
      ...bodies,
      ...(readingWork
        ? {
            args: {
              ...bodies.args,
              run: ({ page, work }: { page: { query: string }; work: { amount: number } }) => ({
                query: `${page.query}:${work.amount}`,
              }),
            },
          }
        : {}),
      ...(landing?.row
        ? {
            chooseChange: {
              slot: "panes.main.verbs.choose",
              kind: "placement",
              source,
              run: () => ["change"],
            },
          }
        : {}),
      ...(landing
        ? { landNative: { slot: "verbs.native.lands", kind: "lands", source, run: landing.run } }
        : {}),
      ...(cellBodies
        ? {
            cellGroup: {
              slot: "cells.amount.groupOf",
              kind: "group",
              source,
              run: (key: string) => [key],
            },
            ...(cellBodies === "draft"
              ? {}
              : {
                  cellShow: {
                    slot: "cells.amount.show",
                    kind: "show",
                    source,
                    run: (value: number) => String(value),
                  },
                }),
            cellLabel: {
              slot: "cells.amount.label",
              kind: "label",
              source,
              run: (group: string) => group.toUpperCase(),
            },
            cellFocus: {
              slot: "cells.amount.focus",
              kind: "focus",
              source,
              run: (key: string) => ({ query: key }),
            },
          }
        : {}),
      ...(presenter
        ? {
            nativePresent: {
              slot: "verbs.native.present",
              kind: "present",
              source,
              run: presenter,
            },
          }
        : {}),
      ...(modelWrite
        ? {
            previewArgs: {
              slot: "readings.preview.args",
              kind: "args",
              source,
              run: () => null,
            },
          }
        : {}),
      main: {
        ...bodies.main,
        run:
          landing?.pane ??
          ((ctx: {
            history?: import("../../../../packages/agent-contracts/src/route-kernel-bodies").WorkHistoryPort;
          }) => createElement("button", { onClick: () => ctx.history!.undo() }, "Pane undo")),
      },
      native: {
        slot: "verbs.native.intent",
        kind: "intent",
        source,
        run: (ctx: { work: { amount: number } }) => (modelWrite ? {} : { amount: ctx.work.amount }),
      },
      change: {
        slot: "verbs.change.patches",
        kind: "work",
        source,
        run: (ctx: { work: { amount: number } }, input: number) => [
          { path: ["amount"] as const, value: ctx.work.amount + input },
        ],
      },
      seed: {
        ...bodies.seed,
        run: () => ({ readings: { notes: "fixture" }, work: { amount: 0 } }),
      },
    },
  } as const;
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: workData,
    hostVersion: "test",
    variants: [{ client: "web" as const, entry: "witness.ts" }],
    modules: [{ id: "witness.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    note: {
      module: workModule,
      closure: { envelope, fingerprint },
      catalog: [
        { key: "notes.read", ...entries["notes.read"].axes, uses: [] },
        { key: "native.write", ...workModule.entries["native.write"].axes, uses: [] },
        ...(modelWrite
          ? [
              {
                key: "native.write.preview",
                ...workModule.entries["native.write.preview"]!.axes,
                uses: [],
              },
            ]
          : []),
      ],
    },
  });
  const result = (await inventory.prepare("note", fingerprint)).admitUnknown(workModule);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.route;
}

const transitionData = {
  ...data,
  transition: "move",
  transitionDeps: { page: ["query"], work: [], readings: ["notes"] },
} as const;
export function transitionProjectionWitness(
  ctx: Parameters<
    BodyBindings<typeof transitionData, typeof schemas, typeof entries>["move"]["run"]
  >[3],
) {
  const query: string = ctx.page.query;
  const evidence = ctx.readings.notes;
  // @ts-expect-error Only transitionDeps readings are available.
  ctx.readings.label;
  // @ts-expect-error Only transitionDeps Page fields are in the evidence context.
  ctx.page.pose;
  return { query, evidence };
}

test("transition dependency references are linked at admission", async () => {
  await expect(
    admitted(false, false, {
      data: { transition: "move", transitionDeps: { page: [], work: [], readings: ["missing"] } },
      bodies: {
        move: {
          slot: "transition",
          kind: "transition",
          source,
          run: () => ({ ok: true, value: {} }),
        },
      },
    }),
  ).rejects.toThrow(/missing/);
});

vi.mock("../route/route-target", async (original) => ({
  ...(await original<typeof import("../route/route-target")>()),
  useRouteTarget: vi.fn(),
}));

test("a mount never receives an admission referring to another route's Work", async () => {
  const owner = await workRoute();
  const { createAdmittedRouteRegistry, resolveRouteBindings } =
    await import("../../../../packages/agent-contracts/src/route-module");
  const registry = createAdmittedRouteRegistry();
  const registration = registry.register(owner);
  const module = {
    ...resolveRouteBindings(registry, owner)!,
    data: {
      ...owner.data,
      key: "foreign",
      address: "/foreign",
      work: { ...owner.data.work!, route: "note" },
    },
  };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: module.data,
    hostVersion: "test",
    variants: [{ client: "web" as const, entry: "witness.ts" }],
    modules: [{ id: "witness.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    foreign: { module, closure: { envelope, fingerprint }, catalog: [] },
  });
  const result = (await inventory.prepare("foreign", fingerprint)).admitUnknown(module);
  expect(result.ok).toBe(false);
  registration.deactivate();
});
