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
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { BridgeError } from "./bridge.ts";

type SnapshotRequest = {
  selector: { kind: "document" } | { kind: "from"; unitId: number; portIndex?: number };
};
const tableRequest = { ids: [...new Set(LOSS_RULES.map((rule) => rule.table))].sort() };
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
const subjectKey = ({ detail: _detail, basis: _basis, ...subject }: DuctsSheetRequest) =>
  canonicalRouteInput(subject);
type Entry = {
  subject: string;
  inputs: DuctsSheetInputs;
  workInputKey: string;
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
  ...(value.owner ? { owner: value.owner } : {}),
});

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
    next: {
      hint: "Repeat this request with basis and detail. legs needs pathId; elements returns walkedElementIds; inputs returns provenance and full blocker closers. Other paths use their zero-based engine path index.",
      legs: [...supply.paths, ...ret.paths].map(({ pathId }) => ({ kind: "legs", pathId })),
      elements: { kind: "elements" },
      inputs: { kind: "inputs" },
    },
  };
}

interface SheetWork {
  workspace: RouteWorkspace;
  key(target: DocumentRef): Promise<WorkKey>;
  author(): WorkAuthor;
}
const inputKey = (request: DuctsSheetRequest) => request.mode === "fan"
  ? `fan:${request.unitId}:${request.portIndex}`
  : `chain:${request.start.elementId}:${request.start.connector ?? ""}:${request.end.elementId}:${request.direction}`;
const mergeInputs = (saved: DuctsSheetInputs, override: DuctsSheetInputs): DuctsSheetInputs => ({
  ...saved, ...override,
  ...(saved.endCfm || override.endCfm ? { endCfm: { ...saved.endCfm, ...override.endCfm } } : {}),
  ...(saved.drops || override.drops ? { drops: { ...saved.drops, ...override.drops } } : {}),
});
export function createDuctsSheets(sources: DuctsSheetSources, work?: SheetWork) {
  async function savedInputs(target: DocumentRef, key?: string) {
    const scope = work ? await work.key(target) : null;
    const owned = scope && work ? await work.workspace.readRaw(scope, "ducts") : null;
    const doc = owned ? ductsDocumentSchema.parse(owned.doc) : null;
    const project = doc?.sheetInputs.project?.edit?.value ?? {};
    const saved = key ? doc?.sheetInputs[key]?.edit?.value ?? {} : {};
    // Only the project cell owns slot, even if old per-fan Work happens to contain one.
    const { slot: _slot, ...local } = saved;
    return { scope, revision: owned?.revision ?? 0, inputs: { ...local, ...(project.slot ? { slot: project.slot } : {}) },
      defaults: { terminalDropInWg: SHIM_TERMINAL_DROP_IN_WG, terminalDropSource: "SHIM placeholder", autoJoinMaxGapIn: 3, splitPolicy: "even" as const,
        ...doc?.sheetDefaults.edit?.value,
        ...(doc?.sheetDefaults.edit?.value.terminalDropInWg !== undefined ? { terminalDropSource: "route settings terminal drop" } : {}),
        slot: doc?.parameters.terminalFlow?.edit?.value,
      } };
  }
  async function persist(request: DuctsSheetRequest, saved: Awaited<ReturnType<typeof savedInputs>>, inputs: DuctsSheetInputs) {
    if (!request.inputs || !work || !saved.scope) return;
    const { slot, ...local } = inputs;
    const patches = [
      ...(request.inputs.slot === undefined ? [] : [{ path: ["sheetInputs", "project", "edit"], value: { value: { slot } } }]),
      ...(Object.keys(request.inputs).some((k) => k !== "slot") ? [{ path: ["sheetInputs", inputKey(request), "edit"], value: { value: local } }] : []),
    ];
    if (!patches.length) return;
    const result = await work.workspace.apply(saved.scope, "ducts", work.author(), patches, saved.revision);
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
  async function current(entry: Entry) {
    const responses = await Promise.all([
      readNative("ducts.snapshot", entry.request, entry.target, entry.version),
      readNative("ducts.tables", tableRequest, entry.target, entry.tablesVersion),
    ]);
    await Promise.all(responses.map((response) => response.body?.cancel()));
  }
  return {
    async sheet(request: DuctsSheetRequest): Promise<DuctsSheetResponse> {
      const saved = await savedInputs(request.target, inputKey(request));
      const inputs = ductsSheetInputsSchema.parse(mergeInputs(saved.inputs, request.inputs ?? {}));
      const subject = canonicalRouteInput([subjectKey({ ...request, inputs }), saved.defaults]);
      if (request.detail) {
        const entry = request.basis ? entries.get(request.basis) : undefined;
        if (!entry || entry.subject !== subject) throw stale();
        await current(entry);
        const base = { target: entry.target, basis: entry.value.basis };
        if (request.detail.kind === "elements")
          return { ...base, kind: "elements", walkedElementIds: entry.value.walkedElementIds };
        if (request.detail.kind === "inputs")
          return {
            ...base,
            kind: "inputs",
            inputs: entry.value.inputs,
            blockers: entry.value.blockers,
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
      const acquisition: SnapshotRequest = {
        selector:
          request.mode === "fan"
            ? { kind: "from", unitId: request.unitId }
            : {
                kind: "from",
                unitId: request.start.elementId,
                ...(request.start.connector === undefined
                  ? {}
                  : { portIndex: request.start.connector }),
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
      const snapshot = (await response.json()) as DuctSnapshot;
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
              defaults: { ...saved.defaults, slot: saved.defaults.slot ?? snapshot.slots?.terminalFlow },
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
        const field = row.name === "airflow slot" ? "slot" : row.name === "split policy" ? "splitPolicy" : null;
        if (field && saved.inputs[field] !== undefined && request.inputs?.[field] === undefined) row.source = "Work edit";
      }
      // The engine hashes its inputs; the host also binds the native observation and exact request.
      value.basis = createHash("sha256")
        .update(JSON.stringify([request.target, version, tablesVersion, subject, value.basis]))
        .digest("hex");
      const entry: Entry = {
        subject,
        inputs,
        workInputKey: inputKey(request),
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
      // ponytail: document is the only snapshot selector yielding every equipment port; whole-document cost is the ceiling until an equipment selector exists.
      const acquisition: SnapshotRequest = { selector: { kind: "document" } };
      const response = await readNative("ducts.snapshot", acquisition, request.target);
      const snapshot = (await response.json()) as DuctSnapshot;
      const roster = suggestRoster(snapshot);
      const saved = await savedInputs(request.target);
      const activeSlot = saved.inputs.slot ?? saved.defaults.slot ?? snapshot.slots?.terminalFlow ?? "terminalFlow";
      const rows = [];
      for (const port of [...roster.fans, ...roster.suggestions]) {
        const cached = [...entries.values()].reverse().find(
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
            const currentInputs = await savedInputs(request.target, cached.workInputKey);
            if (canonicalRouteInput(currentInputs.defaults) === cached.settingsBasis
              && canonicalRouteInput(currentInputs.inputs) === canonicalRouteInput(cached.inputs)
              && candidate.inputs.find((i) => i.name === "airflow slot")?.value === activeSlot) sheet = candidate;
          } catch (error) {
            if (!(error instanceof BridgeError) || error.statusCode !== 409) throw error;
            entries.delete(cached.value.basis);
          }
        }
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
                complete: sheet.totals.supply.complete && sheet.totals.return.complete,
              }
            : {}),
        });
      }
      return ductsRosterResponseSchema.parse({ target: request.target, rows,
        slots: slotCoverage(snapshot.nodes, snapshot.slots?.terminalFlow), activeSlot });
    },
  };
}
