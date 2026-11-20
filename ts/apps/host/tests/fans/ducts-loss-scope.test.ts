import { settle } from "../effect-test.ts";
import {
  DUCT_UNIT_KINDS,
  FAN_BLOCKER_KINDS,
} from "../../../../packages/host-contracts/src/generated/host-ops.generated.ts";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { readFileSync } from "node:fs";
import { expect, test, vi } from "vite-plus/test";
import {
  claimRefusal,
  fanRulings,
  fanWriteRequest,
  fanLosses,
  lossSnapshot,
  unwrittenCells,
  unwrittenReason,
} from "@pe/fans-host/actions";
import { Effect } from "effect";
import type { WorkPath } from "@pe/agent-contracts";
import { designOf } from "@pe/ducts-domain/test-design";
import { mergeFar } from "@pe/ducts-domain/calc/joins";
import {
  buildCalc,
  type BuildCalcInput,
  type FanWriteContext,
  type CalcSnapshot,
} from "@pe/fans-domain/calc/index";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import {
  TEST_WALK,
  inputsFor,
  withFamilyFlipped,
  withPeersRead,
} from "@pe/ducts-domain/test-inputs";
import { ductWriteEvidence } from "@pe/ducts-domain/write-evidence";
import { writeSeal } from "../../src/work-write-boundary.ts";
import { nativeResponseSchema } from "../../../../packages/host-contracts/src/decoders.ts";
import { ductsDesign, stagedValues } from "@pe/duct-systems-contract/ducts";
import { fanClaimSchema } from "@pe/fans-contract/fans-inputs";
import { fansDocumentSchema } from "@pe/fans-contract/fans";

// The saved captures predate the native vocabulary; it is the generated one, added whole.
const walkCapture = {
  parse: (raw: object) =>
    nativeResponseSchema("ducts.snapshot.walk").parse({
      ...raw,
      vocabulary: { unitKinds: [...DUCT_UNIT_KINDS], blockerKinds: [...FAN_BLOCKER_KINDS] },
    }),
};

// D9: the real executor retires its own role under /fans; the shared runtime's filter is tested in ducts-host.
test("the real /fans apply asks to retire its own role only, and retires it under /fans", async () => {
  const role = "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000005";
  const answer = {
    previewOnly: false,
    writes: [
      { kind: "verdict", key: "open-end:101:1", outcome: "written" },
      { kind: "fitting", id: 7, outcome: "written" },
      { kind: "role", id: 99, uniqueId: role.slice("UniqueId:".length), outcome: "written" },
    ],
  };
  const input = {
    terminals: [],
    components: [],
    equipment: [],
    terminalFlows: [],
    equipmentFlows: [],
    fittings: [{ id: 7, ruleKey: "elbow" }],
  };
  const key = {
    binding: "open",
    route: "fans",
    target: null,
    open: { session: "A", openId: "doc" },
  };
  const retireWork = vi.fn((_key: unknown, _route: string, paths: readonly WorkPath[]) =>
    Effect.succeed({ retired: [...paths], revision: 2 }),
  );
  const ctx = {
    admission: {
      target: { kind: "document", ref: { session: "A", openId: "doc" } },
      input: { work: { key, revision: 1 } },
    },
  };
  const execution = {
    prepared: {
      process: {},
      input,
      dependencies: null,
      subjects: { [role]: "5" },
      cells: [["roles", role]],
    },
    step: () => Effect.succeed(answer),
    retireWork,
  };
  await settle(
    fanLosses("sheet.apply", "apply")({} as never, {}).run(
      ctx as never,
      execution as never,
    ) as Effect.Effect<unknown>,
  );
  expect(retireWork.mock.calls).toEqual([[key, "fans", [["roles", role]]]]);
});

test("fan preview survives identical re-pricing but rejects changed model inputs", () => {
  const snapshot = walkCapture.parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../../packages/host-contracts/src/fixtures/k2-four-fan-walk.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  // The raw seal must change even when the owner reports the same decode reason.
  const unreadable = {
    owner: "duct-losses",
    status: "UnknownVersion" as const,
    reason: "version 2",
    rawUtf8Sha256: "a".repeat(64),
  };
  expect(ductWriteEvidence({ ...snapshot, storeReplacement: unreadable })).not.toEqual(
    ductWriteEvidence({
      ...snapshot,
      storeReplacement: { ...unreadable, rawUtf8Sha256: "b".repeat(64) },
    }),
  );
  const work = ductsDesign(
    null,
    fansDocumentSchema.parse({
      componentDrops: {
        [elementSubject(snapshot.nodes.find((n) => n.id === 14088043)!)]: {
          edit: { by: "human", value: { inWg: 0.026 } },
        },
      },
    }),
  );
  const handle = {
    key: {
      binding: "open" as const,
      route: "duct-systems",
      target: null,
      open: { session: "A", openId: "doc" },
    },
    revision: 1,
  };
  const seal = (s: typeof snapshot) =>
    writeSeal({
      caller: { kind: "human", via: "local" },
      request: {
        slots: s.slots,
        fittings: [],
        terminals: [],
        components: [],
        equipment: [],
        terminalFlows: [],
        equipmentFlows: [],
      },
      input: work,
      work: handle,
      incarnation: { openId: "doc" },
      documentMark: { session: "A", openId: "doc", observedSince: null, changedAt: null },
      consumed: [],
      evidence: ductWriteEvidence(s),
    });
  snapshot.walk = {
    startId: 14577391,
    hops: 1,
    elementsReached: snapshot.nodes.length,
    openEnds: 0,
    candidates: [],
    truncated: false,
    unreadPeers: [],
    elapsedMs: 12,
  };
  // Every set-valued collection may be enumerated differently by a fresh native read.
  const permute = (value: unknown, key = "", parent = ""): unknown => {
    if (Array.isArray(value)) {
      const items = value.map((item) => permute(item, "", key));
      return [
        "point",
        "tapPoint",
        "facing",
        "widthAxis",
        "polyline",
        "order",
        "criticalPath",
      ].includes(key) ||
        parent === "polyline" ||
        (key === "ports" && parent === "inline")
        ? items
        : items.reverse();
    }
    return value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([k, v]) => [k, permute(v, k, key)]),
        )
      : value;
  };
  const facts = ductWriteEvidence(snapshot);
  const permuted = permute(snapshot) as typeof snapshot;
  Object.assign(permuted.document, {
    readAt: "new clock",
    elapsedMs: 900,
    futureDiagnostic: "new",
  });
  Object.assign(permuted.walk!, { elapsedMs: 1000, futureDiagnostic: "new" });
  for (const node of permuted.nodes) Object.assign(node, { futureDiagnostic: "new" });
  expect(ductWriteEvidence(permuted)).toEqual(facts);
  const geometry = structuredClone(snapshot);
  geometry.nodes[0]!.connectors[0]!.point[0]! += 1;
  expect(ductWriteEvidence(geometry)).not.toEqual(facts);
  const topology = structuredClone(snapshot);
  topology.nodes[0]!.connectors[0]!.connectedTo = { elementId: 999, connector: 4 };
  expect(ductWriteEvidence(topology)).not.toEqual(facts);
  const preview = seal(snapshot);
  const reread = structuredClone(snapshot);
  reread.document.readAt = "2026-11-02T12:00:00Z";
  reread.document.elapsedMs += 100;
  reread.walk!.elapsedMs += 100;
  reread.nodes.reverse();
  for (const node of reread.nodes) node.connectors.reverse();
  for (const segment of reread.segments) segment.connectors.reverse();
  for (const issue of reread.issues) issue.near?.ports.reverse();
  expect(seal(reread)).toEqual(preview);
  reread.slots.fanFlow = "another parameter";
  expect(seal(reread)).not.toEqual(preview);
});

test("fan loss preparation reads both sides and refuses a truncated walk", async () => {
  const snapshot = walkCapture.parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../../packages/host-contracts/src/fixtures/k2-four-fan-walk.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const read = vi.fn(async () => snapshot);
  expect(await lossSnapshot({ walk: { unitId: 14577391, portIndex: 2 } }, read)).toBe(snapshot);
  expect(read).toHaveBeenCalledExactlyOnceWith({ kind: "from", unitId: 14577391 });
  const truncated = mergeFar(snapshot, {
    ...snapshot,
    walk: {
      startId: 1,
      hops: 1,
      elementsReached: 1,
      openEnds: 0,
      candidates: [],
      elapsedMs: 1,
      truncated: true,
      unreadPeers: [],
    },
  });
  await expect(
    lossSnapshot({ walk: { unitId: 14577391, portIndex: 2 } }, async () => truncated),
  ).rejects.toThrow("truncated");
});

// L2-3, invariant 1: the host's one write derivation. The recorded Manual D fan, replayed as the domain's mint test does.
function manualD(accept: boolean, over: Partial<CalcSnapshot> = {}, typed = true) {
  const fixture = (name: string) =>
    JSON.parse(
      readFileSync(new URL(import.meta.resolve(`@pe/ducts-domain/fixtures/${name}`)), "utf8"),
    );
  const recorded: CalcSnapshot = fixture("manual-d-20261102.json");
  const base = withPeersRead(withFamilyFlipped(recorded, 14577391));
  // Fixture data, not recorded: the capture predates native ESP cohorts, so the fan's instance cohort is stated here.
  const parameterCohorts = [
    {
      parameter: base.slots!.requiredEsp!,
      owner: { kind: "instance" as const, id: 14577391 },
      members: [
        { elementId: 14577391, uniqueId: base.nodes.find((n) => n.id === 14577391)!.uniqueId },
      ],
      complete: true,
      basis: base.document.readAt,
    },
  ];
  const snapshot = { ...base, parameterCohorts, ...over };
  const roster = suggestRoster(recorded as never);
  const input: BuildCalcInput = {
    snapshot,
    fan: { unitId: 14577391, portIndex: 2 },
    grids: toGrids({ tables: fixture("manual-d-tables.json") }),
    roster: [...roster.fans, ...roster.suggestions],
    // Was table-only complete replay; ruling (c), P-102 requires human Work drops at both refusals.
    inputs: inputsFor(snapshot, {
      fittingDrops: typed ? { "proposed:14106988:1|14122436:1>straight": 0.05 } : {},
      endCfm: { 14577391: 900 },
      drops: {
        14577394: 0.0132,
        14577396: 0.18,
        14088043: 0.026,
        ...Object.fromEntries(typed ? [[13926753, 0.04]] : []),
      },
      rulings: [{ pair: ["14106988:1", "14122436:1"], verdict: "accept" }],
    }),
  };
  if (accept)
    input.encounterRulings = buildCalc(input).encounters.map((e) => ({
      at: { elementId: e.elementId, connector: e.connector },
      verdict: "accepted",
      by: "human",
      ref: "replay:accepted-tie-in",
    }));
  const context: FanWriteContext = {
    appliedAt: "2026-11-16T00:00:00Z",
    slots: {
      ...snapshot.slots,
      fanFlow: snapshot.nodes.find((n) => n.id === 14577391)!.flowParameter,
    },
    peerClaims: new Map(),
    rulings: {},
    storeDeletes: {},
  };
  return { input, context };
}

test("a complete claim plans the minted request: required ESP on the fan, and no derived flow", () => {
  const { input, context } = manualD(true);
  const { claim, request } = fanWriteRequest(input, context);
  expect(claim.kind).toBe("complete");
  expect(request.equipment).toEqual([{ id: 14577391, externalStaticInWg: claim.requiredEspInWg }]);
  expect(request.terminalFlows).toEqual([]);
  // The one flow row is the stated (Work) fan flow; nothing derived rides along.
  expect(request.equipmentFlows).toEqual([
    expect.objectContaining({ id: 14577391, cfm: 900, source: "Work:work:test" }),
  ]);
  // The plan timestamp is an input, so an unchanged plan seals the same request at apply.
  expect(fanWriteRequest(input, context).request).toEqual(request);
});

test("a claim that is not complete is refused with its kind and what holds it open", () => {
  const fan = { unitId: 1, portIndex: 0 },
    host = { unitId: 9, portIndex: 1 };
  const boundary = fanClaimSchema.parse({
    kind: "to-boundary",
    basis: "b",
    knownInWg: 0.4,
    coverage: [],
    blockingIds: [],
    boundaries: [
      {
        fan,
        host,
        elementId: 7,
        connector: 2,
        side: "supply",
        verdict: "unruled",
        static: { kind: "none" },
      },
    ],
  });
  expect(claimRefusal(boundary)).toBe(
    "Nothing is written from a to-boundary fan calc (known 0.4 in-wg): unruled tie-in at element 7 connector 2 into unit 9",
  );
  // Was null refusal; ruling (c), P-102 preserves the two real table refusals without typed drops.
  const incomplete = buildCalc(manualD(true, {}, false).input);
  expect(incomplete.claim.kind).toBe("incomplete");
  expect(incomplete.blockers.map((b) => b.id)).toEqual([
    "not-priced:13926753",
    "not-priced:14122436:1",
  ]);
  expect(claimRefusal(incomplete.claim)).toContain("known 2.56803 in-wg");
  // A truncated walk is lost coverage: the claim refuses it without the explicit walk check.
  const truncated = manualD(false, { walk: { ...TEST_WALK, truncated: true } });
  expect(buildCalc(truncated.input).claim.kind).toBe("incomplete");
  expect(() => fanWriteRequest(truncated.input, truncated.context)).toThrow(
    /incomplete fan calc .*: \S/,
  );
});

test("unscoped fan losses name the Inputs control before reading a walk", async () => {
  const read = vi.fn();
  await expect(lossSnapshot(undefined, read)).rejects.toThrow(
    "Choose a fan port in Write scope in Inputs, then plan again.",
  );
  expect(read).not.toHaveBeenCalled();
});

test("a requested write cell that derives no write is refused, never planned as an empty request", () => {
  const snapshot = {
    nodes: [{ id: 1380293, uniqueId: "fixture-terminal", connectors: [] }],
    segments: [],
  } as any;
  const empty = {
    fittings: [],
    terminals: [],
    components: [],
    equipment: [],
    terminalFlows: [],
    equipmentFlows: [],
  } as never;
  expect(
    unwrittenCells(
      empty,
      [
        ["flows", "UniqueId:fixture-terminal"],
        ["rules", "elbow"],
      ],
      snapshot,
    ),
  ).toEqual([["flows", "UniqueId:fixture-terminal"]]);
  expect(
    unwrittenCells(
      { ...(empty as object), terminalFlows: [{ id: 1380293, cfm: 123 }] } as never,
      [["flows", "UniqueId:fixture-terminal"]],
      snapshot,
    ),
  ).toEqual([]);
});

test("an unwritten cell names why: an empty or consumed Work cell is not a staged value", () => {
  // The preserved r82 shape: writeIntent still names both cells after r67 published both edits.
  const fans = fansDocumentSchema.parse({
    componentDrops: {
      "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00de6eef": { edit: null },
      "UniqueId:6d52156a-3876-4d76-b641-341454252f26-0098d62d": {
        edit: { by: "human", value: { inWg: 2.7 } },
      },
    },
  });
  const staged = stagedValues(null, fans);
  expect(
    unwrittenReason(staged, [
      "componentDrops",
      "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00de6eef",
    ]),
  ).toMatch(/no staged edit/);
  // A staged cell that still derives nothing is a different case; it is never called empty.
  expect(
    unwrittenReason(staged, [
      "componentDrops",
      "UniqueId:6d52156a-3876-4d76-b641-341454252f26-0098d62d",
    ]),
  ).toMatch(/^staged/);
});

// Ruling D9 (2026-11-18; field map invariant 8). Red at 272c0120: the fans request carried the staged
// /duct-systems verdict into the store and named the taken-back one in `storeDeletes.verdicts`.
test("a /fans apply stores its own roles only: a staged /duct-systems verdict stays out of the store request", () => {
  const at = "2026-10-20T12:00:00.000Z";
  const verdicts = { "open-end:101:1": { verdict: "ignore", ruledAt: at } };
  const { input, context } = manualD(true, {
    store: {
      version: 3,
      rules: {},
      instances: {},
      terminals: {},
      terminalFlows: {},
      equipmentFlows: {},
      verdicts,
      roles: {},
      workRevision: 3,
    },
  });
  const unit = input.snapshot.nodes.find((n) => n.id === 14577391)!;
  const fan = elementSubject(unit);
  const design = designOf({
    assumptions: {
      "open-end:202:1": { edit: { by: "human", value: { kind: "verdict", verdict: "ignore" } } },
      "open-end:101:1": { edit: { by: "human", delete: true } },
    },
    roles: { [fan]: { edit: { by: "human", value: { role: "fan" } } } },
  });
  const { request } = fanWriteRequest(input, {
    ...context,
    ...fanRulings(design, input.snapshot, context.appliedAt),
  });
  // The stored verdict Work takes back is neither re-ruled nor deleted here; the staged one is not sent.
  expect(request.store!.verdicts).toEqual(verdicts);
  expect(request.storeDeletes).toEqual({ roles: [] });
  expect(request.store!.roles).toEqual({
    [unit.uniqueId]: { role: "fan", ruledAt: context.appliedAt },
  });
});
