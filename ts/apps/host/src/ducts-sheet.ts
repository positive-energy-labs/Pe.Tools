import { createHash } from "node:crypto";
import {
  DUCTS_BODY_VERSION_HEADER,
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
import { contextFetch } from "@pe/runtime/context";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { LOSS_RULES } from "@pe/ducts-domain/loss-rules";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { buildSheet, buildChain } from "@pe/ducts-domain/sheet/index";
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
  JSON.stringify(subject);
type Entry = {
  subject: string;
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

export function createDuctsSheets(sources: DuctsSheetSources) {
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
      const subject = subjectKey(request);
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
              roster: ports,
            })
          : buildChain({
              snapshot,
              grids,
              start: request.start,
              end: request.end,
              direction: request.direction,
              roster: ports,
            });
      // The engine hashes its inputs; the host also binds the native observation and exact request.
      value.basis = createHash("sha256")
        .update(JSON.stringify([request.target, version, tablesVersion, subject, value.basis]))
        .digest("hex");
      const entry: Entry = {
        subject,
        request: acquisition,
        version,
        tablesVersion,
        target: request.target,
        mode: request.mode,
        value,
      };
      await current(entry);
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
      const rows = [];
      for (const port of [...roster.fans, ...roster.suggestions]) {
        const cached = [...entries.values()].find(
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
            sheet = cached.value as Sheet;
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
      return ductsRosterResponseSchema.parse({ target: request.target, rows });
    },
  };
}
