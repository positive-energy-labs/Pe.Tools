import { createHash } from "node:crypto";
import {
  canonicalRouteInput,
  DUCTS_BODY_VERSION_HEADER,
  ductsDocumentSchema,
  ductsSheetInputsSchema,
  type DuctsSheetInputs,
  type WorkKey,
  type WorkAuthor,
  refusalText,
  ductsRosterResponseSchema,
  ductsSheetResponseSchema,
  type DocumentRef,
  type DuctsRosterRequest,
  type DuctsSheetRequest,
  type DuctsSheetOverview,
  type DuctsSheetResponse,
} from "@pe/agent-contracts";
import { createPeClient } from "@pe/agent-contracts/pe-api";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import type { RouteWorkspace } from "@pe/runtime";
import { slotCoverage } from "@pe/ducts-domain/kernel/terminal-flow";
import { contextFetch } from "@pe/runtime/context";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { LOSS_RULES } from "@pe/ducts-domain/loss-rules";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { SHIM_TERMINAL_DROP_IN_WG, buildSheet, buildChain } from "@pe/ducts-domain/sheet/index";
import type { Sheet, Chain, SheetPath } from "@pe/ducts-domain/sheet/types";
import { worksheet } from "@pe/ducts-domain/sheet/worksheet";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { BridgeError } from "./bridge.ts";

/** The near-miss tolerance C# measures model health under (one home, ducts LEDGER 2026-10-29); absent, its default. */
type Tolerances = { autoJoinGapIn?: number };
type SnapshotRequest = {
  selector:
    | { kind: "document" }
    | { kind: "roster" }
    | ({ kind: "from"; unitId: number; portIndex?: number } & Tolerances);
};
// Each rule's default and the fallback it prices when that default is not served (ER5-2 for ER5-1).
const tableRequest = {
  ids: [
    ...new Set(
      LOSS_RULES.flatMap((rule) => [rule.table, ...(rule.fallback ? [rule.fallback] : [])]),
    ),
  ].sort(),
};
/** Union two `from` reads of one document by element id (a walked copy wins over a candidate copy), and their health by id. */
function mergeSnapshots(a: DuctSnapshot, b: DuctSnapshot): DuctSnapshot {
  const union = <T extends { id: number; reason?: string | null }>(
    x: readonly T[],
    y: readonly T[],
  ) => {
    const byId = new Map(x.map((e) => [e.id, e]));
    for (const e of y) {
      const have = byId.get(e.id);
      if (!have || ((have.reason ?? "walked") !== "walked" && (e.reason ?? "walked") === "walked"))
        byId.set(e.id, e);
    }
    return [...byId.values()];
  };
  return {
    ...a,
    nodes: union(a.nodes as never[], b.nodes as never[]) as DuctSnapshot["nodes"],
    segments: union(a.segments as never[], b.segments as never[]) as DuctSnapshot["segments"],
    // Health is model truth, measured the same way in either read; the first copy of an id stands.
    issues: [...new Map([...b.issues, ...a.issues].map((i) => [i.id, i])).values()],
  };
}
export interface DuctsSheetSources {
  call: (
    key: "ducts.snapshot" | "ducts.tables",
    request: SnapshotRequest | { ids: string[] },
    target: DocumentRef,
    version?: string,
  ) => Promise<Response>;
}

/** Use /call admission and its raw reading owner, including on a retained detail hit. */
export const sheetNativeRead =
  (base: string): DuctsSheetSources["call"] =>
  (key, request, target, version) =>
    createPeClient(base, contextFetch).response(
      "operation.call",
      {
        body: { key, request },
      },
      {
        headers: {
          [HOST_RPC_BRIDGE_SESSION_HEADER]: target.session,
          [HOST_RPC_DOCUMENT_HEADER]: target.openId,
          ...(version ? { [DUCTS_BODY_VERSION_HEADER]: version } : {}),
        },
      },
    );

const stale = () =>
  new BridgeError("Stale sheet basis; read a new overview before using detail handles", 409, {
    notDispatched: true,
  });
const subjectKey = ({
  detail: _detail,
  basis: _basis,
  proposal: _proposal,
  ...subject
}: DuctsSheetRequest) => canonicalRouteInput(subject);
type Entry = {
  /** Target, mode, fan or chain, the project inputs and the defaults: what one sheet is a sheet of. */
  subject: string;
  inputs: DuctsSheetInputs;
  settingsBasis: string;
  request: SnapshotRequest;
  version: string;
  tablesVersion: string;
  target: DocumentRef;
  value: Sheet | Chain;
  mode: "fan" | "chain";
};

const pathsOf = (value: Sheet | Chain): SheetPath[] =>
  "paths" in value ? value.paths : value.path ? [value.path] : [];
const compact = (value: Sheet["blockers"][number]) => ({
  id: value.id,
  kind: value.kind,
  elementId: value.elementId,
  ...(value.connector === undefined ? {} : { connector: value.connector }),
  effectInWg: value.effectInWg,
  closer: value.closer.kind,
  ...(value.proposal ? { proposal: value.proposal } : {}),
  ...(value.owner ? { owner: value.owner } : {}),
  ...(value.causedBy ? { causedBy: value.causedBy } : {}),
});
/** Known blockers first, then the assumed pass's own (R-B consequences cite a known id). */
/** Known first: a blocker the known pass raises is never a consequence of an assumed heal (R-B). */
const allBlockers = (value: Sheet | Chain) => {
  const known = new Map(value.blockers.map((b) => [b.id, b]));
  const assumed = "assumed" in value ? value.assumed.blockers.filter((b) => !known.has(b.id)) : [];
  return [...known.values(), ...assumed];
};

function overview(entry: Entry): DuctsSheetOverview {
  const paths = pathsOf(entry.value);
  const side = (name: "supply" | "return") => {
    const ranked = paths
      .map((path, index) => ({ path, index }))
      .filter(({ path }) => path.side === name);
    return {
      paths: ranked.slice(0, 5).map(({ path, index }) => ({
        pathId: String(index),
        end: path.end,
        knownInWg: path.knownInWg,
        complete: path.complete,
        legCount: path.legIds.length,
        blockerIds: path.blockerIds,
      })),
      rest: Math.max(0, ranked.length - 5),
    };
  };
  const supply = side("supply"),
    ret = side("return");
  return {
    kind: "overview",
    mode: entry.mode,
    target: entry.target,
    basis: entry.value.basis,
    fan: "fan" in entry.value ? entry.value.fan : null,
    totals: "totals" in entry.value ? entry.value.totals : null,
    paths: { supply, return: ret },
    blockers: entry.value.blockers.map(compact),
    assumedBlockers: "assumed" in entry.value ? entry.value.assumed.blockers.map(compact) : [],
    next: {
      hint: "Repeat this request with basis and detail. legs needs pathId; elements returns walkedElementIds; inputs returns provenance and full blocker closers; worksheet returns every run and section with its legs. Other paths use their zero-based engine path index.",
      legs: [...supply.paths, ...ret.paths].map(({ pathId }) => ({ kind: "legs", pathId })),
      elements: { kind: "elements" },
      inputs: { kind: "inputs" },
      worksheet: { kind: "worksheet" },
    },
  };
}
// SHIM(velocity-limits): stand-in Manual D rules of thumb until the firm defaults file lands
// (kaitpw 2026-10-29: "over" is velocity, limits are firm defaults); route settings override.
const SHIM_VELOCITY_LIMIT_FPM = { supply: 900, return: 700 } as const;

interface SheetWork {
  workspace: RouteWorkspace;
  key(target: DocumentRef): Promise<WorkKey>;
  author(): WorkAuthor;
}
/** Records merge key by key; `clear` removes keys and is never saved (it is request-only). */
const mergeInputs = (saved: DuctsSheetInputs, override: DuctsSheetInputs): DuctsSheetInputs => {
  const { clear, ...rest } = override;
  const record = (key: "endCfm" | "drops" | "unitCfm") => {
    if (!saved[key] && !rest[key] && !clear?.[key]) return {};
    const merged: Record<string, number> = { ...saved[key], ...rest[key] };
    for (const id of clear?.[key] ?? []) delete merged[id];
    return { [key]: merged };
  };
  const { clear: _saved, ...base } = saved;
  return { ...base, ...rest, ...record("endCfm"), ...record("drops"), ...record("unitCfm") };
};
export function createDuctsSheets(sources: DuctsSheetSources, work?: SheetWork) {
  // Inputs are per project (R2): one `sheetInputs.project` cell for every fan; older per-fan keys are ignored.
  async function savedInputs(target: DocumentRef) {
    const scope = work ? await work.key(target) : null;
    const owned = scope && work ? await work.workspace.readRaw(scope, "ducts") : null;
    const doc = owned ? ductsDocumentSchema.parse(owned.doc) : null;
    return {
      scope,
      revision: owned?.revision ?? 0,
      inputs: doc?.sheetInputs.project?.edit?.value ?? {},
      defaults: {
        terminalDropInWg: SHIM_TERMINAL_DROP_IN_WG,
        terminalDropSource: "SHIM placeholder",
        splitPolicy: "even" as const,
        ...doc?.sheetDefaults.edit?.value,
        ...(doc?.sheetDefaults.edit?.value.terminalDropInWg !== undefined
          ? { terminalDropSource: "route settings terminal drop" }
          : {}),
        slot: doc?.parameters.terminalFlow?.edit?.value,
      },
    };
  }
  async function persist(
    request: DuctsSheetRequest,
    saved: Awaited<ReturnType<typeof savedInputs>>,
    inputs: DuctsSheetInputs,
  ) {
    if (!request.inputs || !work || !saved.scope) return;
    const result = await work.workspace.apply(
      saved.scope,
      "ducts",
      work.author(),
      [{ path: ["sheetInputs", "project", "edit"], value: { value: inputs } }],
      saved.revision,
    );
    if (!result.ok) throw new BridgeError(refusalText(result), 409, { notDispatched: true });
  }
  // Results are disposable. The raw owner separately bounds acquisition bytes and invalidates versions.
  const entries = new Map<string, Entry>();
  async function readNative(
    key: "ducts.snapshot" | "ducts.tables",
    request: SnapshotRequest | { ids: string[] },
    target: DocumentRef,
    version?: string,
  ) {
    const response = await sources.call(key, request, target, version);
    if (!response.ok)
      throw new BridgeError(await response.text(), response.status, { notDispatched: true });
    return response;
  }
  /**
   * The C# `from` walk follows Revit connectors only, so it stops where an accepted join bridges a gap:
   * the far side arrives as an open-end candidate and its own connections read as open ends that are
   * not open in Revit (MUAS-1's FA 43 onto the louver plenum, 2026-10-28). Walk again from the far
   * element of every accepted pair whose near side was walked, merge, and repeat until no accepted
   * join points outside the read. Elements are unioned by id; a walked copy wins over a candidate.
   * ponytail: one extra `from` read per bridged join and round (bounded at four rounds); fold the
   * seeds into one native read if this gets slow.
   */
  async function followAcceptedJoins(
    snapshot: DuctSnapshot,
    rulings: readonly { pair: readonly string[]; verdict: string }[],
    target: DocumentRef,
    tolerances: Tolerances,
  ): Promise<DuctSnapshot> {
    type Walked = { id: number; reason?: string | null };
    const elementOf = (end: string) => Number(end.split(":")[0]);
    const seeded = new Set<number>();
    let merged = snapshot;
    for (let round = 0; round < 4; round += 1) {
      const walked = new Set(
        [...merged.nodes, ...merged.segments]
          .filter((e) => ((e as Walked).reason ?? "walked") === "walked")
          .map((e) => e.id),
      );
      const seeds = rulings
        .filter((r) => r.verdict === "accept")
        .flatMap((r) => {
          const [a, b] = r.pair.map(elementOf) as [number, number];
          return walked.has(a) && !walked.has(b) ? [b] : walked.has(b) && !walked.has(a) ? [a] : [];
        })
        .filter((id) => !seeded.has(id));
      if (seeds.length === 0) break;
      for (const id of seeds) {
        seeded.add(id);
        const more = (await (
          await readNative(
            "ducts.snapshot",
            { selector: { kind: "from", unitId: id, ...tolerances } },
            target,
          )
        ).json()) as DuctSnapshot;
        merged = mergeSnapshots(merged, more);
      }
    }
    return merged;
  }
  async function current(entry: Entry) {
    const responses = await Promise.all([
      readNative("ducts.snapshot", entry.request, entry.target, entry.version),
      readNative("ducts.tables", tableRequest, entry.target, entry.tablesVersion),
    ]);
    await Promise.all(responses.map((response) => response.body?.cancel()));
  }
  return {
    async sheet(request: DuctsSheetRequest): Promise<DuctsSheetResponse> {
      const saved = await savedInputs(request.target);
      if (request.proposal) {
        const entry = request.basis ? entries.get(request.basis) : undefined;
        // The entry must be this fan's sheet over the project inputs and defaults as saved now.
        if (
          !entry ||
          request.detail ||
          entry.subject !==
            canonicalRouteInput([subjectKey({ ...request, inputs: saved.inputs }), saved.defaults])
        )
          throw stale();
        await current(entry);
        const all = allBlockers(entry.value);
        const choice = request.proposal;
        // A person may accept the same-class proposal or the class crossing the row offers beside it.
        const offered = (b: (typeof all)[number]) =>
          [b.proposal?.pair, b.closer.crossing?.pair].some(
            (pair) => pair?.every((p) => choice.pair.includes(p)) ?? false,
          );
        if (!all.some(offered))
          throw new BridgeError("Proposal is not on this sheet basis", 409, {
            notDispatched: true,
          });
        if (!work)
          throw new BridgeError("Document Work is unavailable for proposal rulings", 409, {
            notDispatched: true,
          });
        const rulings = (saved.inputs.rulings ?? []).filter(
          (r) => !r.pair.every((p) => choice.pair.includes(p)),
        );
        request = { ...request, inputs: { ...request.inputs, rulings: [...rulings, choice] } };
      }
      const inputs = ductsSheetInputsSchema.parse(mergeInputs(saved.inputs, request.inputs ?? {}));
      const subject = canonicalRouteInput([subjectKey({ ...request, inputs }), saved.defaults]);
      if (request.detail) {
        const entry = request.basis ? entries.get(request.basis) : undefined;
        if (!entry || entry.subject !== subject) throw stale();
        await current(entry);
        const base = { target: entry.target, basis: entry.value.basis };
        if (request.detail.kind === "elements")
          return { ...base, kind: "elements", walkedElementIds: entry.value.walkedElementIds };
        if (request.detail.kind === "worksheet") {
          if (!("assumed" in entry.value))
            throw new BridgeError("A worksheet is a fan sheet's; a chain has one path", 400, {
              notDispatched: true,
            });
          const typed = saved.defaults.velocityLimitFpm;
          const limits = {
            supply: typed?.supply ?? SHIM_VELOCITY_LIMIT_FPM.supply,
            return: typed?.return ?? SHIM_VELOCITY_LIMIT_FPM.return,
          };
          const sheet = entry.value;
          const w = worksheet(sheet, { maxFpm: limits });
          const named = new Set([...w.supply.runs, ...w.return.runs].flatMap((r) => r.legIds));
          return ductsSheetResponseSchema.parse({
            ...base,
            kind: "worksheet",
            limits: {
              supplyFpm: limits.supply,
              returnFpm: limits.return,
              source:
                typed?.supply != null || typed?.return != null
                  ? "route settings"
                  : "SHIM placeholder",
            },
            supply: w.supply,
            return: w.return,
            legs: Object.fromEntries([...named].map((id) => [id, sheet.legs[id]])),
          });
        }
        if (request.detail.kind === "inputs")
          return {
            ...base,
            kind: "inputs",
            edits: entry.inputs,
            ends: [
              ...new Map(
                [
                  ...pathsOf(entry.value),
                  ...("assumed" in entry.value ? entry.value.assumed.paths : []),
                ].map((p) => [canonicalRouteInput(p.end), p.end]),
              ).values(),
            ],
            inputs: entry.value.inputs,
            blockers: allBlockers(entry.value),
          };
        const path = pathsOf(entry.value)[Number(request.detail.pathId)];
        if (!/^(0|[1-9][0-9]*)$/.test(request.detail.pathId) || !path)
          throw new BridgeError("Unknown sheet path handle", 404, { notDispatched: true });
        return ductsSheetResponseSchema.parse({
          ...base,
          kind: "legs",
          pathId: request.detail.pathId,
          legs: path.legIds.map((id) => entry.value.legs[id]),
        });
      }
      // A fan sheet walks both sides, so acquire from every port of the unit; the engine picks this fan's ports.
      // ponytail: an ERV acquires its second fan's sides too; filter by the roster's port pairing if reads get heavy.
      // The route's auto-join gap is a read tolerance: C# measures health under it (its own default when unset).
      const tolerances: Tolerances =
        saved.defaults.autoJoinMaxGapIn == null
          ? {}
          : { autoJoinGapIn: saved.defaults.autoJoinMaxGapIn };
      const acquisition: SnapshotRequest = {
        selector:
          request.mode === "fan"
            ? { kind: "from", unitId: request.unitId, ...tolerances }
            : {
                kind: "from",
                unitId: request.start.elementId,
                ...(request.start.connector === undefined
                  ? {}
                  : { portIndex: request.start.connector }),
                ...tolerances,
              },
      };
      const [response, tables] = await Promise.all([
        readNative("ducts.snapshot", acquisition, request.target),
        readNative("ducts.tables", tableRequest, request.target),
      ]);
      const version = response.headers.get(DUCTS_BODY_VERSION_HEADER);
      const tablesVersion = tables.headers.get(DUCTS_BODY_VERSION_HEADER);
      if (!version || !tablesVersion)
        throw new BridgeError("Ducts read did not return an observation version", 409, {
          notDispatched: true,
        });
      const snapshot = await followAcceptedJoins(
        (await response.json()) as DuctSnapshot,
        inputs.rulings ?? [],
        request.target,
        tolerances,
      );
      const grids = toGrids(await tables.json());
      const roster = suggestRoster(snapshot);
      const ports = [...roster.fans, ...roster.suggestions];
      const value =
        request.mode === "fan"
          ? buildSheet({
              snapshot,
              grids,
              fan: { unitId: request.unitId, portIndex: request.portIndex },
              ...inputs,
              ...(inputs.unitCfm?.[String(request.unitId)] != null
                ? { sideStreamCfm: inputs.unitCfm[String(request.unitId)] }
                : {}),
              defaults: {
                ...saved.defaults,
                slot: saved.defaults.slot ?? snapshot.slots?.terminalFlow,
              },
              roster: ports,
            })
          : buildChain({
              snapshot,
              grids,
              start: request.start,
              end: request.end,
              direction: request.direction,
              ...inputs,
              defaults: saved.defaults,
              flowCfm: inputs.endCfm?.[request.end.elementId],
              roster: ports,
            });
      for (const row of value.inputs) {
        const field =
          row.name === "airflow slot" ? "slot" : row.name === "split policy" ? "splitPolicy" : null;
        if (field && saved.inputs[field] !== undefined && request.inputs?.[field] === undefined)
          row.source = "Work edit";
      }
      // The engine hashes its inputs; the host also binds the native observation and exact request.
      value.basis = createHash("sha256")
        .update(JSON.stringify([request.target, version, tablesVersion, subject, value.basis]))
        .digest("hex");
      const entry: Entry = {
        subject,
        inputs,
        settingsBasis: canonicalRouteInput(saved.defaults),
        request: acquisition,
        version,
        tablesVersion,
        target: request.target,
        mode: request.mode,
        value,
      };
      await current(entry);
      await persist(request, saved, inputs);
      for (const [basis, previous] of entries)
        if (previous.subject === subject) entries.delete(basis);
      while (entries.size >= 16) entries.delete(entries.keys().next().value!);
      entries.set(value.basis, entry);
      return ductsSheetResponseSchema.parse(overview(entry));
    },
    async roster(request: DuctsRosterRequest) {
      // Units and terminals only: the whole-document read exceeded the 16 MiB bridge frame on Chadds (2026-10-28).
      const acquisition: SnapshotRequest = { selector: { kind: "roster" } };
      const response = await readNative("ducts.snapshot", acquisition, request.target);
      const snapshot = (await response.json()) as DuctSnapshot;
      const roster = suggestRoster(snapshot);
      const saved = await savedInputs(request.target);
      const activeSlot =
        saved.inputs.slot ?? saved.defaults.slot ?? snapshot.slots?.terminalFlow ?? "terminalFlow";
      // Project inputs and defaults are one basis for every fan: a ruling on one fan stales them all.
      const projectBasis = canonicalRouteInput(saved.defaults);
      const projectInputs = canonicalRouteInput(saved.inputs);
      const rows = [];
      for (const port of [...roster.fans, ...roster.suggestions]) {
        const cached = [...entries.values()]
          .reverse()
          .find(
            (entry) =>
              entry.mode === "fan" &&
              entry.target.session === request.target.session &&
              entry.target.openId === request.target.openId &&
              "fan" in entry.value &&
              entry.value.fan.unitId === port.unitId &&
              entry.value.fan.portIndex === port.portIndex,
          );
        let sheet: Sheet | undefined;
        if (cached) {
          try {
            await current(cached);
            const candidate = cached.value as Sheet;
            if (
              projectBasis === cached.settingsBasis &&
              projectInputs === canonicalRouteInput(cached.inputs) &&
              candidate.inputs.find((i) => i.name === "airflow slot")?.value === activeSlot
            )
              sheet = candidate;
          } catch (error) {
            if (!(error instanceof BridgeError) || error.statusCode !== 409) throw error;
            entries.delete(cached.value.basis);
          }
        }
        // R3 (kaitpw 2026-10-28): `externalStatic` is the firm's one ESP parameter
        // (PE_M_Fan_ExternalStaticPressure), the REQUIRED ESP Pe writes; the page labels it
        // "required (written)". Rated ESP has no firm slot yet; the contract field keeps its name.
        const rating =
          snapshot.nodes
            .find((node) => node.id === port.unitId)
            ?.facts.find((fact) => fact.key === "externalStatic")?.value ?? null;
        rows.push({
          unitId: port.unitId,
          portIndex: port.portIndex,
          mark: port.tag,
          kind: port.kind,
          side: port.side,
          ratedEspInWg: sheet?.fan.ratedEspInWg ?? rating,
          confirmed: roster.fans.includes(port),
          ...(sheet
            ? {
                blockerCount: sheet.blockers.length,
                requiredEspInWg: sheet.totals.requiredEspInWg,
                requiredEspAssumedInWg: sheet.totals.requiredEspAssumedInWg,
                complete: sheet.totals.supply.complete && sheet.totals.return.complete,
              }
            : {}),
        });
      }
      return ductsRosterResponseSchema.parse({
        target: request.target,
        rows,
        // The active slot is listed even when no terminal holds it (a route default such as "Actual Supply Air Flow" read 0/0 unlisted on Chadds).
        slots: slotCoverage(snapshot.nodes, [activeSlot, snapshot.slots?.terminalFlow]),
        activeSlot,
      });
    },
  };
}
